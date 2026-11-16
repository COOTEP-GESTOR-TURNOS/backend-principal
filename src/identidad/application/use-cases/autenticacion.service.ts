import { randomUUID } from 'node:crypto';
import type { AuditLogPort } from '../../../auditoria/application/ports/out/audit-log.port';
import { DemasiadosIntentosError, NoAutenticadoError } from '../../../compartido/application/errores-aplicacion';
import { PermisoDenegadoError, ReglaNegocioError } from '../../../compartido/domain/errores';
import { PoliticaContrasena } from '../../domain/politica-contrasena';
import {
  asignacionesParaToken,
  type CuentaUsuario,
  normalizarCorreo,
  requiereMfa,
  rolPrincipal,
} from '../../domain/usuario';
import { LIMITES } from '../limites';
import { aPerfil } from '../perfil';
import type {
  AutenticacionUseCase,
  ConfiguracionMfa,
  PasoPendiente,
  PerfilUsuario,
  ResultadoIngreso,
  SesionEmitida,
} from '../ports/in/autenticacion.use-case';
import type { PasswordHasherPort } from '../ports/out/identidad.ports';
import type { CifradorPort, EmisorTokensPort, TotpPort } from '../ports/out/seguridad.ports';
import type { AlmacenTemporalPort, Cliente, LimitadorPort, SesionesPort } from '../ports/out/sesiones.port';
import type { UsuarioRepository } from '../ports/out/usuario.repository';

const USUARIO_DESCONOCIDO = '00000000-0000-0000-0000-000000000000';

/** Reto guardado mientras la persona completa los pasos pendientes del inicio de sesión. */
interface Reto {
  usuarioId: string;
  cliente: Cliente;
  pasos: PasoPendiente[];
  amr: string[];
  /** Secreto TOTP propuesto (cifrado) mientras se confirma el primer código. */
  secretoPendiente?: string;
  intentos: number;
}

const claveReto = (id: string) => `reto:${id}`;

/**
 * Caso de uso de autenticación (RF-01, RF-03, RF-05; CU-01).
 * 1) contraseña con límite de intentos; 2) pasos pendientes: cambiar la clave temporal,
 * configurar o verificar MFA (administradores); 3) sesión: JWT de acceso de 10 min y
 * renovación opaca que rota en Redis.
 */
export class AutenticacionService implements AutenticacionUseCase {
  private hashFicticio?: Promise<string>;

  constructor(
    private readonly usuarios: UsuarioRepository,
    private readonly hasher: PasswordHasherPort,
    private readonly sesiones: SesionesPort,
    private readonly almacen: AlmacenTemporalPort,
    private readonly limitador: LimitadorPort,
    private readonly emisor: EmisorTokensPort,
    private readonly totp: TotpPort,
    private readonly cifrador: CifradorPort,
    private readonly auditoria: AuditLogPort,
    private readonly ahora: () => Date = () => new Date(),
  ) {}

  async iniciarSesion(cmd: { correo: string; clave: string; ip: string; cliente: Cliente }): Promise<ResultadoIngreso> {
    const correo = normalizarCorreo(cmd.correo);
    const claveLimite = `login:intentos:${correo}:${cmd.ip}`;
    const espera = await this.limitador.bloqueadoPor(claveLimite, LIMITES.intentosLogin);
    if (espera > 0) {
      throw new DemasiadosIntentosError(
        `Demasiados intentos fallidos. Intenta de nuevo en ${Math.ceil(espera / 60)} minutos`,
        espera,
      );
    }

    const cuenta = await this.usuarios.buscarPorEmail(correo);
    // Sin cuenta o sin contraseña igual se calcula un hash: el tiempo de respuesta no revela si existe.
    const hash = cuenta?.passwordHash ?? (await (this.hashFicticio ??= this.hasher.hash('cuenta-inexistente-cootep')));
    const valida = (await this.hasher.verificar(hash, cmd.clave)) && Boolean(cuenta?.passwordHash);
    if (!cuenta || !valida) {
      await this.limitador.registrarFallo(claveLimite, LIMITES.ventanaLoginSeg);
      await this.auditoria.registrar({
        ambito: 'GLOBAL',
        actorId: cuenta?.id ?? USUARIO_DESCONOCIDO,
        actorRol: cuenta ? rolPrincipal(cuenta.roles) : 'DESCONOCIDO',
        accion: 'LOGIN_FALLIDO',
        objetivoTipo: 'CUENTA',
        objetivoId: correo,
        ip: cmd.ip,
      });
      throw new NoAutenticadoError('CREDENCIALES_INVALIDAS', 'Correo o contraseña incorrectos');
    }
    await this.limitador.reiniciar(claveLimite);

    if (!cuenta.activo) {
      throw new PermisoDenegadoError('CUENTA_INACTIVA', 'Tu cuenta está desactivada. Comunícate con tu agencia');
    }
    if (!cuenta.emailVerificado) {
      throw new PermisoDenegadoError(
        'CORREO_NO_VERIFICADO',
        'Confirma tu correo con el enlace que te enviamos antes de ingresar',
      );
    }
    return this.continuar(cuenta, cmd.cliente, ['pwd'], cmd.ip);
  }

  async continuar(cuenta: CuentaUsuario, cliente: Cliente, amr: string[], ip?: string): Promise<ResultadoIngreso> {
    const pasos: PasoPendiente[] = [];
    if (cuenta.debeCambiarPassword && amr.includes('pwd')) pasos.push('CAMBIAR_CLAVE');
    if (requiereMfa(cuenta.roles)) pasos.push(cuenta.mfaSecretoCifrado ? 'VERIFICAR_MFA' : 'CONFIGURAR_MFA');
    if (pasos.length === 0) {
      return { estado: 'SESION_INICIADA', sesion: await this.abrirSesion(cuenta, cliente, amr, ip) };
    }
    const id = randomUUID();
    const reto: Reto = { usuarioId: cuenta.id, cliente, pasos, amr, intentos: 0 };
    await this.almacen.guardar(claveReto(id), reto, LIMITES.retoSeg);
    return { estado: 'PASO_PENDIENTE', reto: id, paso: pasos[0], nombre: cuenta.nombre };
  }

  async cambiarClaveInicial(cmd: { reto: string; claveNueva: string }): Promise<ResultadoIngreso> {
    const { reto, cuenta } = await this.leerReto(cmd.reto, 'CAMBIAR_CLAVE');
    // Los administradores tendrán MFA, por eso su mínimo es 8; los demás, 15.
    const errores = PoliticaContrasena.validar(cmd.claveNueva, { tieneMfa: requiereMfa(cuenta.roles) });
    if (errores.length > 0) throw new ReglaNegocioError('CLAVE_DEBIL', errores.join('. '));
    if (cuenta.passwordHash && (await this.hasher.verificar(cuenta.passwordHash, cmd.claveNueva))) {
      throw new ReglaNegocioError('CLAVE_REPETIDA', 'La contraseña nueva debe ser distinta de la temporal');
    }
    await this.usuarios.actualizarPassword(cuenta.id, await this.hasher.hash(cmd.claveNueva));
    return this.avanzar(cmd.reto, reto, { ...cuenta, debeCambiarPassword: false });
  }

  async prepararMfa(idReto: string): Promise<ConfiguracionMfa> {
    const { reto, cuenta } = await this.leerReto(idReto, 'CONFIGURAR_MFA');
    const secreto = this.totp.generarSecreto();
    reto.secretoPendiente = this.cifrador.cifrar(secreto);
    await this.almacen.guardar(claveReto(idReto), reto, LIMITES.retoSeg);
    const uri = this.totp.uriAprovisionamiento(secreto, cuenta.email);
    return { secreto, uri, qr: await this.totp.qr(uri) };
  }

  async verificarMfa(cmd: { reto: string; codigo: string; ip: string }): Promise<ResultadoIngreso> {
    const { reto, cuenta } = await this.leerReto(cmd.reto, 'CONFIGURAR_MFA', 'VERIFICAR_MFA');
    const configurando = reto.pasos[0] === 'CONFIGURAR_MFA';
    const cifrado = configurando ? reto.secretoPendiente : cuenta.mfaSecretoCifrado;
    if (!cifrado) throw new ReglaNegocioError('MFA_SIN_PREPARAR', 'Primero escanea el código QR');
    const secreto = this.cifrador.descifrar(cifrado);
    const codigo = cmd.codigo.replace(/\s/g, '');

    const valido =
      this.totp.verificar(secreto, codigo, this.ahora()) &&
      (await this.almacen.guardarSiNoExiste(`totp:usado:${cuenta.id}:${codigo}`, LIMITES.totpUsadoSeg));
    if (!valido) {
      reto.intentos += 1;
      if (reto.intentos >= LIMITES.intentosMfa) {
        await this.almacen.eliminar(claveReto(cmd.reto));
        throw new DemasiadosIntentosError('Demasiados códigos incorrectos. Vuelve a iniciar sesión');
      }
      await this.almacen.guardar(claveReto(cmd.reto), reto, LIMITES.retoSeg);
      throw new NoAutenticadoError('CODIGO_MFA_INVALIDO', 'El código no es válido o ya se usó');
    }

    let actualizada = cuenta;
    if (configurando) {
      await this.usuarios.guardarMfa(cuenta.id, cifrado);
      actualizada = { ...cuenta, mfaSecretoCifrado: cifrado };
      await this.auditoria.registrar({
        ambito: 'GLOBAL',
        actorId: cuenta.id,
        actorRol: rolPrincipal(cuenta.roles),
        accion: 'MFA_CONFIGURADO',
        objetivoTipo: 'USUARIO',
        objetivoId: cuenta.id,
        ip: cmd.ip,
      });
    }
    reto.amr = [...new Set([...reto.amr, 'otp'])];
    return this.avanzar(cmd.reto, reto, actualizada, cmd.ip);
  }

  async renovar(tokenRenovacion: string): Promise<SesionEmitida> {
    const rotada = await this.sesiones.rotar(tokenRenovacion);
    if (!rotada) throw new NoAutenticadoError('SESION_VENCIDA', 'Tu sesión venció. Ingresa de nuevo');
    const cuenta = await this.usuarios.buscarPorId(rotada.sesion.usuarioId);
    if (!cuenta || !cuenta.activo) {
      await this.sesiones.cerrar(rotada.token);
      throw new NoAutenticadoError('SESION_VENCIDA', 'Tu sesión venció. Ingresa de nuevo');
    }
    // Si le asignaron un rol administrativo después de ingresar, debe volver a entrar con MFA.
    if (requiereMfa(cuenta.roles) && !rotada.sesion.amr.includes('otp')) {
      await this.sesiones.cerrar(rotada.token);
      throw new NoAutenticadoError('REQUIERE_MFA', 'Tu rol ahora exige MFA. Ingresa de nuevo');
    }
    const acceso = await this.emisor.emitirAcceso(cuenta.id, asignacionesParaToken(cuenta.roles), rotada.sesion.amr);
    return { tokenAcceso: acceso.token, expiraEn: acceso.expiraEn, tokenRenovacion: rotada.token, usuario: aPerfil(cuenta) };
  }

  async cerrarSesion(cmd: { tokenRenovacion?: string; acceso?: { jti?: string; expira?: number } }): Promise<void> {
    if (cmd.tokenRenovacion) await this.sesiones.cerrar(cmd.tokenRenovacion);
    const { jti, expira } = cmd.acceso ?? {};
    if (jti && expira) {
      const restantes = expira - Math.floor(this.ahora().getTime() / 1000);
      if (restantes > 0) await this.sesiones.revocarAcceso(jti, restantes);
    }
  }

  async perfil(usuarioId: string): Promise<PerfilUsuario> {
    const cuenta = await this.usuarios.buscarPorId(usuarioId);
    if (!cuenta || !cuenta.activo) throw new NoAutenticadoError('SESION_VENCIDA', 'Tu sesión venció');
    return aPerfil(cuenta);
  }

  private async leerReto(id: string, ...pasosValidos: PasoPendiente[]): Promise<{ reto: Reto; cuenta: CuentaUsuario }> {
    const reto = await this.almacen.obtener<Reto>(claveReto(id));
    if (!reto) throw new NoAutenticadoError('RETO_VENCIDO', 'El tiempo para completar el ingreso venció. Ingresa de nuevo');
    if (!pasosValidos.includes(reto.pasos[0])) {
      throw new ReglaNegocioError('PASO_INCORRECTO', `El paso pendiente es ${reto.pasos[0]}`);
    }
    const cuenta = await this.usuarios.buscarPorId(reto.usuarioId);
    if (!cuenta || !cuenta.activo) {
      await this.almacen.eliminar(claveReto(id));
      throw new NoAutenticadoError('RETO_VENCIDO', 'La cuenta ya no está disponible');
    }
    return { reto, cuenta };
  }

  /** Quita el paso cumplido; si no queda ninguno, abre la sesión. */
  private async avanzar(id: string, reto: Reto, cuenta: CuentaUsuario, ip?: string): Promise<ResultadoIngreso> {
    reto.pasos = reto.pasos.slice(1);
    reto.secretoPendiente = undefined;
    reto.intentos = 0;
    if (reto.pasos.length > 0) {
      await this.almacen.guardar(claveReto(id), reto, LIMITES.retoSeg);
      return { estado: 'PASO_PENDIENTE', reto: id, paso: reto.pasos[0], nombre: cuenta.nombre };
    }
    await this.almacen.eliminar(claveReto(id));
    return { estado: 'SESION_INICIADA', sesion: await this.abrirSesion(cuenta, reto.cliente, reto.amr, ip) };
  }

  private async abrirSesion(cuenta: CuentaUsuario, cliente: Cliente, amr: string[], ip?: string): Promise<SesionEmitida> {
    const tokenRenovacion = await this.sesiones.crear({
      usuarioId: cuenta.id,
      cliente,
      amr,
      creadaEn: this.ahora().getTime(),
    });
    const acceso = await this.emisor.emitirAcceso(cuenta.id, asignacionesParaToken(cuenta.roles), amr);
    await this.usuarios.registrarIngreso(cuenta.id, this.ahora());
    const rol = rolPrincipal(cuenta.roles);
    if (rol === 'SUPERADMIN' || rol === 'ADMIN_AGENCIA') {
      await this.auditoria.registrar({
        ambito: rol === 'SUPERADMIN' ? 'GLOBAL' : (cuenta.roles.find((r) => r.rol === 'ADMIN_AGENCIA')?.agenciaId ?? 'GLOBAL'),
        actorId: cuenta.id,
        actorRol: rol,
        accion: 'LOGIN_ADMIN',
        objetivoTipo: 'SESION',
        objetivoId: cuenta.id,
        detalle: { amr, cliente },
        ip,
      });
    }
    return { tokenAcceso: acceso.token, expiraEn: acceso.expiraEn, tokenRenovacion, usuario: aPerfil(cuenta) };
  }
}
