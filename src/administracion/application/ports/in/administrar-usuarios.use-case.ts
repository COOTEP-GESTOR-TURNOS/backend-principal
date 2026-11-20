import type { Paginacion, SolicitudPagina } from '../../../../compartido/domain/paginacion';
import type { AsignacionRol, Principal, Rol } from '../../../../compartido/domain/principal';
import type { AsignacionGuardada, TipoDocumento } from '../../../../identidad/domain/usuario';

export const ADMINISTRAR_USUARIOS = Symbol('ADMINISTRAR_USUARIOS');

/** Ficha que ve un administrador: sin hash de contraseña ni secreto MFA. */
export interface FichaUsuario {
  id: string;
  email: string;
  nombre: string;
  tipoDocumento: TipoDocumento | null;
  numeroDocumento: string | null;
  fechaNacimiento: string | null;
  activo: boolean;
  emailVerificado: boolean;
  mfaActivo: boolean;
  /** false mientras no abra el enlace de activación. */
  tienePassword: boolean;
  creadoEn: Date;
  ultimoIngresoEn: Date | null;
  roles: AsignacionGuardada[];
}

export interface FiltroAdministracion extends SolicitudPagina {
  texto?: string;
  rol?: Rol;
  agenciaId?: string;
  activo?: boolean;
}

export interface DatosNuevoUsuario {
  email: string;
  nombre: string;
  tipoDocumento?: TipoDocumento;
  numeroDocumento?: string;
  fechaNacimiento?: string;
  rol: AsignacionRol;
}

export interface CambiosAdministrativos {
  nombre?: string;
  tipoDocumento?: TipoDocumento;
  numeroDocumento?: string;
  fechaNacimiento?: string | null;
  activo?: boolean;
}

/** Puerto de entrada: gestión de usuarios y roles dentro del ámbito de cada administrador (RF-18). */
export interface AdministrarUsuariosUseCase {
  listar(actor: Principal, filtro: FiltroAdministracion): Promise<Paginacion & { elementos: FichaUsuario[] }>;
  obtener(actor: Principal, id: string): Promise<FichaUsuario>;
  crear(actor: Principal, datos: DatosNuevoUsuario, ip?: string): Promise<{ usuario: FichaUsuario; activacionEnviada: boolean }>;
  actualizar(actor: Principal, id: string, cambios: CambiosAdministrativos, ip?: string): Promise<FichaUsuario>;
  asignarRol(actor: Principal, id: string, asignacion: AsignacionRol, ip?: string): Promise<FichaUsuario>;
  revocarRol(actor: Principal, id: string, asignacionId: string, ip?: string): Promise<FichaUsuario>;
  reenviarActivacion(actor: Principal, id: string): Promise<void>;
  /** Solo el superadministrador: para quien perdió el teléfono con la app autenticadora. */
  restablecerMfa(actor: Principal, id: string, ip?: string): Promise<void>;
}
