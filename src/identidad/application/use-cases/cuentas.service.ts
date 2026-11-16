import type { AuditLogPort } from '../../../auditoria/application/ports/out/audit-log.port';
import { NoAutenticadoError } from '../../../compartido/application/errores-aplicacion';
import { NoEncontradoError, ReglaNegocioError } from '../../../compartido/domain/errores';
import { PoliticaContrasena } from '../../domain/politica-contrasena';
import { normalizarCorreo, requiereMfa, rolPrincipal } from '../../domain/usuario';
import { EnlacesUnSoloUso } from '../enlaces';
import { LIMITES, type PropositoEnlace } from '../limites';
import { plantillas } from '../plantillas-correo';
import type { CambiosPerfil, CuentasUseCase, DatosRegistro } from '../ports/in/cuentas.use-case';
import type { PasswordHasherPort } from '../ports/out/identidad.ports';
import type { CorreoPort } from '../ports/out/seguridad.ports';
import type { AlmacenTemporalPort, LimitadorPort, SesionesPort } from '../ports/out/sesiones.port';
import type { UsuarioRepository } from '../ports/out/usuario.repository';

/**
 * Caso de uso de cuentas (RF-04 y registro de asociados): todo lo que llega por correo usa
 * enlaces de un solo uso y nunca revela si una dirección está registrada.
 */
export class CuentasService implements CuentasUseCase {
  private readonly enlaces: EnlacesUnSoloUso;

  constructor(
    private readonly usuarios: UsuarioRepository,
    private readonly hasher: PasswordHasherPort,
    private readonly sesiones: SesionesPort,
    almacen: AlmacenTemporalPort,
    private readonly limitador: LimitadorPort,
    private readonly correo: CorreoPort,
    private readonly auditoria: AuditLogPort,
    /** Dirección de la web para armar los enlaces (por ejemplo http://localhost:8080). */
    private readonly urlPublica: string,
  ) {
    this.enlaces = new EnlacesUnSoloUso(almacen);
  }

  async registrar(datos: DatosRegistro): Promise<{ id: string; email: string }> {
    this.validarClave(datos.clave, false);
    const cuenta = await this.usuarios.crear({
      email: normalizarCorreo(datos.email),
      nombre: datos.nombre.trim(),
      tipoDocumento: datos.tipoDocumento,
      numeroDocumento: datos.numeroDocumento.trim(),
      fechaNacimiento: datos.fechaNacimiento ?? null,
      passwordHash: await this.hasher.hash(datos.clave),
      emailVerificado: false,
      rol: { rol: 'ASOCIADO' },
    });
    await this.enviar(cuenta.id, cuenta.email, cuenta.nombre, 'VERIFICAR_CORREO');
    return { id: cuenta.id, email: cuenta.email };
  }

  async verificarCorreo(token: string): Promise<void> {
    const usuarioId = await this.enlaces.consumir(token, 'VERIFICAR_CORREO');
    if (!usuarioId) throw new NoAutenticadoError('ENLACE_INVALIDO', 'El enlace no es válido, ya se usó o venció');
    await this.usuarios.marcarCorreoVerificado(usuarioId);
  }

  async reenviarVerificacion(correo: string): Promise<void> {
    const cuenta = await this.usuarios.buscarPorEmail(normalizarCorreo(correo));
    if (cuenta && cuenta.activo && !cuenta.emailVerificado) {
      await this.enviar(cuenta.id, cuenta.email, cuenta.nombre, 'VERIFICAR_CORREO');
    }
  }

  async solicitarRecuperacion(correo: string): Promise<void> {
    const cuenta = await this.usuarios.buscarPorEmail(normalizarCorreo(correo));
    if (cuenta && cuenta.activo) await this.enviar(cuenta.id, cuenta.email, cuenta.nombre, 'RECUPERAR');
  }

  async restablecerClave(cmd: { token: string; claveNueva: string }): Promise<void> {
    // El mismo formulario sirve para recuperar y para activar una cuenta creada por un administrador.
    let proposito: PropositoEnlace = 'RECUPERAR';
    let usuarioId = await this.enlaces.ver(cmd.token, proposito);
    if (!usuarioId) {
      proposito = 'ACTIVAR';
      usuarioId = await this.enlaces.ver(cmd.token, proposito);
    }
    const cuenta = usuarioId ? await this.usuarios.buscarPorId(usuarioId) : null;
    if (!cuenta || !cuenta.activo) throw new NoAutenticadoError('ENLACE_INVALIDO', 'El enlace no es válido, ya se usó o venció');

    // Se valida antes de gastar el enlace: una clave débil no obliga a pedir otro correo.
    this.validarClave(cmd.claveNueva, requiereMfa(cuenta.roles));
    if (!(await this.enlaces.consumir(cmd.token, proposito))) {
      throw new NoAutenticadoError('ENLACE_INVALIDO', 'El enlace no es válido, ya se usó o venció');
    }
    // Abrir el enlace prueba que la persona controla el correo.
    await this.usuarios.actualizarPassword(cuenta.id, await this.hasher.hash(cmd.claveNueva), { verificarCorreo: true });
    await this.sesiones.cerrarTodas(cuenta.id);
    await this.auditoria.registrar({
      ambito: 'GLOBAL',
      actorId: cuenta.id,
      actorRol: rolPrincipal(cuenta.roles),
      accion: proposito === 'ACTIVAR' ? 'CUENTA_ACTIVADA' : 'CLAVE_RESTABLECIDA',
      objetivoTipo: 'USUARIO',
      objetivoId: cuenta.id,
    });
  }

  async enviarActivacion(usuarioId: string, rolTexto: string): Promise<void> {
    const cuenta = await this.usuarios.buscarPorId(usuarioId);
    if (!cuenta) throw new NoEncontradoError('USUARIO_NO_ENCONTRADO', 'El usuario no existe');
    const token = await this.enlaces.emitir(cuenta.id, 'ACTIVAR', LIMITES.activarSeg);
    await this.correo.enviar(
      plantillas.activar(cuenta.email, cuenta.nombre, `${this.urlPublica}/restablecer?token=${token}&tipo=activar`, rolTexto),
    );
  }

  async cambiarClave(usuarioId: string, cmd: { claveActual?: string; claveNueva: string }): Promise<void> {
    const cuenta = await this.usuarios.buscarPorId(usuarioId);
    if (!cuenta) throw new NoEncontradoError('USUARIO_NO_ENCONTRADO', 'El usuario no existe');
    if (cuenta.passwordHash) {
      const correcta = cmd.claveActual ? await this.hasher.verificar(cuenta.passwordHash, cmd.claveActual) : false;
      if (!correcta) throw new ReglaNegocioError('CLAVE_ACTUAL_INCORRECTA', 'La contraseña actual no es correcta');
    }
    this.validarClave(cmd.claveNueva, requiereMfa(cuenta.roles));
    await this.usuarios.actualizarPassword(cuenta.id, await this.hasher.hash(cmd.claveNueva));
  }

  async actualizarPerfil(usuarioId: string, cambios: CambiosPerfil): Promise<void> {
    if ((cambios.tipoDocumento === undefined) !== (cambios.numeroDocumento === undefined)) {
      throw new ReglaNegocioError('DOCUMENTO_INCOMPLETO', 'Envía el tipo y el número de documento juntos');
    }
    await this.usuarios.actualizar(usuarioId, {
      ...(cambios.nombre !== undefined ? { nombre: cambios.nombre.trim() } : {}),
      ...(cambios.tipoDocumento !== undefined ? { tipoDocumento: cambios.tipoDocumento } : {}),
      ...(cambios.numeroDocumento !== undefined ? { numeroDocumento: cambios.numeroDocumento.trim() } : {}),
      ...(cambios.fechaNacimiento !== undefined ? { fechaNacimiento: cambios.fechaNacimiento } : {}),
    });
  }

  private validarClave(clave: string, tieneMfa: boolean): void {
    const errores = PoliticaContrasena.validar(clave, { tieneMfa });
    if (errores.length > 0) throw new ReglaNegocioError('CLAVE_DEBIL', errores.join('. '));
  }

  /**
   * Envía un enlace respetando el límite de correos por dirección; si se supera, calla.
   * Un fallo del servidor de correo tampoco se informa (lo registra el adaptador): la respuesta
   * no debe revelar si la cuenta existe, y la persona puede pedir otro enlace.
   */
  private async enviar(usuarioId: string, email: string, nombre: string, proposito: 'RECUPERAR' | 'VERIFICAR_CORREO'): Promise<void> {
    const clave = `correos:${proposito}:${email}`;
    if ((await this.limitador.bloqueadoPor(clave, LIMITES.correosPorVentana)) > 0) return;
    await this.limitador.registrarFallo(clave, LIMITES.ventanaCorreosSeg);

    const mensaje =
      proposito === 'RECUPERAR'
        ? plantillas.recuperar(
            email,
            nombre,
            `${this.urlPublica}/restablecer?token=${await this.enlaces.emitir(usuarioId, 'RECUPERAR', LIMITES.recuperarSeg)}`,
          )
        : plantillas.verificarCorreo(
            email,
            nombre,
            `${this.urlPublica}/verificar-correo?token=${await this.enlaces.emitir(usuarioId, 'VERIFICAR_CORREO', LIMITES.verificarCorreoSeg)}`,
          );
    await this.correo.enviar(mensaje).catch(() => undefined);
  }
}
