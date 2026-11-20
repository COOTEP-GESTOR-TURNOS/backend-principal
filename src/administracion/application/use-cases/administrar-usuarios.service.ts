import type { AuditLogPort } from '../../../auditoria/application/ports/out/audit-log.port';
import { NoEncontradoError, PermisoDenegadoError, ReglaNegocioError } from '../../../compartido/domain/errores';
import { metadatosPagina, resolverPagina } from '../../../compartido/domain/paginacion';
import type { AsignacionRol, Principal } from '../../../compartido/domain/principal';
import type { CuentasUseCase } from '../../../identidad/application/ports/in/cuentas.use-case';
import type { SesionesPort } from '../../../identidad/application/ports/out/sesiones.port';
import type { UsuarioRepository } from '../../../identidad/application/ports/out/usuario.repository';
import { PoliticaAdministracion as Politica } from '../../../identidad/domain/politica-administracion';
import { type CuentaUsuario, normalizarCorreo, rolPrincipal } from '../../../identidad/domain/usuario';
import type {
  AdministrarUsuariosUseCase,
  CambiosAdministrativos,
  DatosNuevoUsuario,
  FichaUsuario,
  FiltroAdministracion,
} from '../ports/in/administrar-usuarios.use-case';

const NOMBRES_ROL: Record<string, string> = {
  SUPERADMIN: 'superadministrador',
  ADMIN_AGENCIA: 'administrador de agencia',
  FUNCIONARIO: 'funcionario',
  ASOCIADO: 'asociado',
};

function aFicha(c: CuentaUsuario): FichaUsuario {
  return {
    id: c.id,
    email: c.email,
    nombre: c.nombre,
    tipoDocumento: c.tipoDocumento,
    numeroDocumento: c.numeroDocumento,
    fechaNacimiento: c.fechaNacimiento,
    activo: c.activo,
    emailVerificado: c.emailVerificado,
    mfaActivo: c.mfaSecretoCifrado !== null,
    tienePassword: c.passwordHash !== null,
    creadoEn: c.creadoEn,
    ultimoIngresoEn: c.ultimoIngresoEn,
    roles: c.roles,
  };
}

/**
 * Administración de usuarios (RF-18, CU-05, CU-06). El superadministrador gestiona a todos; el
 * administrador de agencia, solo a los funcionarios de su agencia. Todo cambio y todo intento
 * fuera del ámbito queda en la auditoría de Cassandra (RN-15).
 */
export class AdministrarUsuariosService implements AdministrarUsuariosUseCase {
  constructor(
    private readonly usuarios: UsuarioRepository,
    private readonly sesiones: SesionesPort,
    private readonly cuentas: CuentasUseCase,
    private readonly auditoria: AuditLogPort,
  ) {}

  async listar(actor: Principal, f: FiltroAdministracion) {
    let agencias: string[] | undefined;
    if (Politica.esSuperadmin(actor)) {
      agencias = f.agenciaId ? [f.agenciaId] : undefined;
    } else {
      const propias = Politica.agenciasAdministradas(actor);
      if (propias.length === 0) throw new PermisoDenegadoError('FUERA_DE_AMBITO', 'No administras ninguna agencia');
      if (f.agenciaId && !propias.includes(f.agenciaId)) {
        throw new PermisoDenegadoError('FUERA_DE_AMBITO', 'Solo puedes ver los usuarios de tu agencia');
      }
      agencias = f.agenciaId ? [f.agenciaId] : propias;
    }
    const { pagina, tamano } = resolverPagina(f);
    const { elementos, total } = await this.usuarios.listar({ ...f, pagina, tamano, texto: f.texto?.trim() || undefined, agencias });
    return { elementos: elementos.map(aFicha), ...metadatosPagina({ pagina, tamano }, total) };
  }

  async obtener(actor: Principal, id: string): Promise<FichaUsuario> {
    return aFicha(await this.visible(actor, id));
  }

  async crear(actor: Principal, datos: DatosNuevoUsuario, ip?: string) {
    Politica.validarAmbito(datos.rol);
    await this.exigirPermisoDeAsignar(actor, datos.rol, 'USUARIO_NUEVO', ip);
    const cuenta = await this.usuarios.crear({
      email: normalizarCorreo(datos.email),
      nombre: datos.nombre.trim(),
      tipoDocumento: datos.tipoDocumento ?? null,
      numeroDocumento: datos.numeroDocumento?.trim() ?? null,
      fechaNacimiento: datos.fechaNacimiento ?? null,
      passwordHash: null,
      emailVerificado: false,
      rol: datos.rol,
      asignadoPor: actor.id,
    });
    await this.auditar(actor, 'USUARIO_CREADO', cuenta.id, datos.rol.agenciaId, { rol: datos.rol }, ip);

    // Si el correo falla, la cuenta queda creada y el administrador puede reenviar la activación.
    const activacionEnviada = await this.cuentas
      .enviarActivacion(cuenta.id, NOMBRES_ROL[datos.rol.rol])
      .then(() => true)
      .catch(() => false);
    return { usuario: aFicha(cuenta), activacionEnviada };
  }

  async actualizar(actor: Principal, id: string, cambios: CambiosAdministrativos, ip?: string): Promise<FichaUsuario> {
    const cuenta = await this.visible(actor, id);
    if (!Politica.puedeGestionar(actor, cuenta.roles)) {
      await this.negar(actor, 'USUARIO_ACTUALIZADO', id, ip);
    }
    if ((cambios.tipoDocumento === undefined) !== (cambios.numeroDocumento === undefined)) {
      throw new ReglaNegocioError('DOCUMENTO_INCOMPLETO', 'Envía el tipo y el número de documento juntos');
    }
    if (cambios.activo === false) {
      Politica.impedirAutoBloqueo(actor, id, 'DESACTIVAR');
      await this.impedirQuedarSinSuperadmin(cuenta);
    }
    await this.usuarios.actualizar(id, {
      nombre: cambios.nombre?.trim(),
      tipoDocumento: cambios.tipoDocumento,
      numeroDocumento: cambios.numeroDocumento?.trim(),
      fechaNacimiento: cambios.fechaNacimiento,
      activo: cambios.activo,
    });
    if (cambios.activo === false) await this.sesiones.cerrarTodas(id);

    const accion =
      cambios.activo === false && cuenta.activo
        ? 'USUARIO_DESACTIVADO'
        : cambios.activo === true && !cuenta.activo
          ? 'USUARIO_ACTIVADO'
          : 'USUARIO_ACTUALIZADO';
    await this.auditar(actor, accion, id, this.ambitoDe(actor, cuenta), { campos: Object.keys(cambios) }, ip);
    return this.obtener(actor, id);
  }

  async asignarRol(actor: Principal, id: string, asignacion: AsignacionRol, ip?: string): Promise<FichaUsuario> {
    Politica.validarAmbito(asignacion);
    await this.exigirPermisoDeAsignar(actor, asignacion, id, ip);
    const cuenta = await this.usuarios.buscarPorId(id);
    if (!cuenta) throw new NoEncontradoError('USUARIO_NO_ENCONTRADO', 'El usuario no existe');
    await this.usuarios.asignarRol(id, asignacion, actor.id);
    await this.auditar(actor, 'ROL_ASIGNADO', id, asignacion.agenciaId, { rol: asignacion }, ip);
    return aFicha((await this.usuarios.buscarPorId(id))!);
  }

  async revocarRol(actor: Principal, id: string, asignacionId: string, ip?: string): Promise<FichaUsuario> {
    const cuenta = await this.visible(actor, id);
    const asignacion = cuenta.roles.find((r) => r.id === asignacionId);
    if (!asignacion) throw new NoEncontradoError('ASIGNACION_NO_ENCONTRADA', 'Esa asignación de rol no existe');
    await this.exigirPermisoDeAsignar(actor, asignacion, id, ip);
    if (asignacion.rol === 'SUPERADMIN') {
      Politica.impedirAutoBloqueo(actor, id, 'REVOCAR_SUPERADMIN');
      await this.impedirQuedarSinSuperadmin(cuenta);
    }
    if (cuenta.roles.length === 1) {
      throw new ReglaNegocioError('SIN_ROLES', 'Es su único rol: desactiva la cuenta en lugar de quitarlo');
    }
    await this.usuarios.revocarRol(id, asignacionId);
    // Cierra sus sesiones para que el permiso retirado deje de valer de inmediato.
    await this.sesiones.cerrarTodas(id);
    const { id: _, asignadoEn: __, ...rol } = asignacion;
    await this.auditar(actor, 'ROL_REVOCADO', id, asignacion.agenciaId, { rol }, ip);
    return aFicha((await this.usuarios.buscarPorId(id))!);
  }

  async reenviarActivacion(actor: Principal, id: string): Promise<void> {
    const cuenta = await this.visible(actor, id);
    if (!Politica.puedeGestionar(actor, cuenta.roles)) await this.negar(actor, 'ACTIVACION_REENVIADA', id);
    if (!cuenta.activo) throw new ReglaNegocioError('CUENTA_INACTIVA', 'Activa la cuenta antes de enviar el enlace');
    await this.cuentas.enviarActivacion(id, NOMBRES_ROL[rolPrincipal(cuenta.roles)] ?? 'usuario');
  }

  async restablecerMfa(actor: Principal, id: string, ip?: string): Promise<void> {
    if (!Politica.esSuperadmin(actor)) await this.negar(actor, 'MFA_RESTABLECIDO', id, ip);
    const cuenta = await this.visible(actor, id);
    await this.usuarios.guardarMfa(cuenta.id, null);
    await this.sesiones.cerrarTodas(cuenta.id);
    await this.auditar(actor, 'MFA_RESTABLECIDO', id, undefined, undefined, ip);
  }

  /** Si no la puede ver, responde 404: no revela que la cuenta existe (RN-14). */
  private async visible(actor: Principal, id: string): Promise<CuentaUsuario> {
    const cuenta = await this.usuarios.buscarPorId(id);
    if (!cuenta || !Politica.puedeVer(actor, cuenta.roles)) {
      throw new NoEncontradoError('USUARIO_NO_ENCONTRADO', 'El usuario no existe');
    }
    return cuenta;
  }

  private async exigirPermisoDeAsignar(actor: Principal, asignacion: AsignacionRol, objetivoId: string, ip?: string) {
    if (!Politica.puedeAsignar(actor, asignacion)) {
      await this.auditar(actor, 'INTENTO_FUERA_DE_AMBITO', objetivoId, asignacion.agenciaId, { rol: asignacion.rol }, ip);
      throw new PermisoDenegadoError(
        'FUERA_DE_AMBITO',
        asignacion.rol === 'FUNCIONARIO'
          ? 'Solo puedes asignar funcionarios de tu agencia'
          : `No puedes asignar el rol ${NOMBRES_ROL[asignacion.rol]}`,
      );
    }
  }

  private async negar(actor: Principal, accion: string, objetivoId: string, ip?: string): Promise<never> {
    await this.auditar(actor, 'INTENTO_FUERA_DE_AMBITO', objetivoId, undefined, { accion }, ip);
    throw new PermisoDenegadoError('FUERA_DE_AMBITO', 'Tu rol no permite gestionar a esta persona');
  }

  private async impedirQuedarSinSuperadmin(cuenta: CuentaUsuario): Promise<void> {
    if (cuenta.roles.some((r) => r.rol === 'SUPERADMIN') && (await this.usuarios.contarSuperadminsActivos()) <= 1) {
      throw new ReglaNegocioError('ULTIMO_SUPERADMIN', 'Debe quedar al menos un superadministrador activo');
    }
  }

  /** Ámbito de la auditoría: la agencia del administrador que actúa o GLOBAL. */
  private ambitoDe(actor: Principal, cuenta: CuentaUsuario): string | undefined {
    if (Politica.esSuperadmin(actor)) return cuenta.roles.find((r) => r.agenciaId)?.agenciaId;
    return Politica.agenciasAdministradas(actor)[0];
  }

  private auditar(actor: Principal, accion: string, objetivoId: string, ambito?: string, detalle?: Record<string, unknown>, ip?: string) {
    return this.auditoria.registrar({
      ambito: ambito ?? 'GLOBAL',
      actorId: actor.id,
      actorRol: rolPrincipal(actor.roles),
      accion,
      objetivoTipo: 'USUARIO',
      objetivoId,
      detalle,
      ip,
    });
  }
}
