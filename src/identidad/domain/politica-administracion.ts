import { PermisoDenegadoError, ReglaNegocioError } from '../../compartido/domain/errores';
import type { AsignacionRol, Principal } from '../../compartido/domain/principal';

/**
 * Quién puede administrar a quién (RF-18, CU-05, CU-06, RN-15).
 * - El superadministrador gestiona a todos y asigna cualquier rol.
 * - El administrador de agencia (directivo de sucursal) solo da de alta, edita y asigna
 *   funcionarios de SU agencia. No crea administradores ni superadministradores.
 * Son funciones puras: el caso de uso las consulta y la auditoría registra los intentos negados.
 */
export class PoliticaAdministracion {
  /** Valida que la asignación tenga el ámbito correcto para su rol (lo repite un CHECK en SQL). */
  static validarAmbito(a: AsignacionRol): void {
    const conAgencia = Boolean(a.agenciaId);
    const conServicio = Boolean(a.servicioId);
    const valido =
      ((a.rol === 'SUPERADMIN' || a.rol === 'ASOCIADO') && !conAgencia && !conServicio) ||
      (a.rol === 'ADMIN_AGENCIA' && conAgencia && !conServicio) ||
      (a.rol === 'FUNCIONARIO' && conAgencia);
    if (!valido) {
      throw new ReglaNegocioError(
        'AMBITO_INVALIDO',
        a.rol === 'ADMIN_AGENCIA' || a.rol === 'FUNCIONARIO'
          ? `El rol ${a.rol} necesita una agencia${a.rol === 'ADMIN_AGENCIA' ? ' y no lleva servicio' : ''}`
          : `El rol ${a.rol} no lleva agencia ni servicio`,
      );
    }
  }

  static esSuperadmin(actor: Principal): boolean {
    return actor.roles.some((r) => r.rol === 'SUPERADMIN');
  }

  /** Agencias en las que el actor es administrador. */
  static agenciasAdministradas(actor: Principal): string[] {
    return actor.roles.filter((r) => r.rol === 'ADMIN_AGENCIA' && r.agenciaId).map((r) => r.agenciaId!);
  }

  /** ¿Puede cambiar servicios, ventanillas, horario y parámetros de esta agencia? (RF-17, RN-15) */
  static puedeAdministrarAgencia(actor: Principal, agenciaId: string): boolean {
    return this.esSuperadmin(actor) || this.agenciasAdministradas(actor).includes(agenciaId);
  }

  /** ¿Puede el actor asignar o revocar esta asignación? */
  static puedeAsignar(actor: Principal, a: AsignacionRol): boolean {
    if (this.esSuperadmin(actor)) return true;
    return a.rol === 'FUNCIONARIO' && !!a.agenciaId && this.agenciasAdministradas(actor).includes(a.agenciaId);
  }

  /** ¿Puede ver la ficha de un usuario con estos roles? */
  static puedeVer(actor: Principal, rolesObjetivo: readonly AsignacionRol[]): boolean {
    if (this.esSuperadmin(actor)) return true;
    const agencias = this.agenciasAdministradas(actor);
    return rolesObjetivo.some(
      (r) => (r.rol === 'FUNCIONARIO' || r.rol === 'ADMIN_AGENCIA') && !!r.agenciaId && agencias.includes(r.agenciaId),
    );
  }

  /**
   * ¿Puede editar sus datos, activarlo o desactivarlo? El administrador de agencia solo gestiona
   * a quien es funcionario de su agencia y no tiene ningún rol administrativo.
   */
  static puedeGestionar(actor: Principal, rolesObjetivo: readonly AsignacionRol[]): boolean {
    if (this.esSuperadmin(actor)) return true;
    const agencias = this.agenciasAdministradas(actor);
    const funcionarioDeSuAgencia = rolesObjetivo.some(
      (r) => r.rol === 'FUNCIONARIO' && !!r.agenciaId && agencias.includes(r.agenciaId),
    );
    const esAdministrativo = rolesObjetivo.some((r) => r.rol === 'SUPERADMIN' || r.rol === 'ADMIN_AGENCIA');
    const funcionarioDeOtra = rolesObjetivo.some(
      (r) => r.rol === 'FUNCIONARIO' && !!r.agenciaId && !agencias.includes(r.agenciaId),
    );
    return funcionarioDeSuAgencia && !esAdministrativo && !funcionarioDeOtra;
  }

  /** Nadie se quita a sí mismo el rol de superadministrador ni se desactiva (evita quedar sin acceso). */
  static impedirAutoBloqueo(actor: Principal, objetivoId: string, accion: 'DESACTIVAR' | 'REVOCAR_SUPERADMIN'): void {
    if (actor.id === objetivoId) {
      throw new PermisoDenegadoError(
        'AUTO_BLOQUEO',
        accion === 'DESACTIVAR' ? 'No puedes desactivar tu propia cuenta' : 'No puedes quitarte tu propio rol de superadministrador',
      );
    }
  }
}
