import type { AsignacionRol, Rol } from '../../../../compartido/domain/principal';
import type { AsignacionGuardada, CuentaUsuario, TipoDocumento } from '../../../domain/usuario';
import type { ProveedorOidc } from './identidad.ports';

export const USUARIO_REPOSITORY = Symbol('USUARIO_REPOSITORY');

export interface NuevoUsuario {
  email: string;
  nombre: string;
  tipoDocumento?: TipoDocumento | null;
  numeroDocumento?: string | null;
  fechaNacimiento?: string | null;
  passwordHash?: string | null;
  emailVerificado: boolean;
  debeCambiarPassword?: boolean;
  /** Rol inicial; se guarda en la misma transacción que el usuario. */
  rol: AsignacionRol;
  asignadoPor?: string | null;
  /** Cuenta federada que se vincula al crearlo (inicio con Google). */
  identidad?: { proveedor: ProveedorOidc; sujeto: string };
}

export interface CambiosUsuario {
  nombre?: string;
  tipoDocumento?: TipoDocumento | null;
  numeroDocumento?: string | null;
  fechaNacimiento?: string | null;
  activo?: boolean;
}

export interface FiltroUsuarios {
  /** Busca en nombre, correo o número de documento. */
  texto?: string;
  rol?: Rol;
  /** Solo usuarios con algún rol en estas agencias (ámbito del administrador de agencia). */
  agencias?: string[];
  activo?: boolean;
  pagina: number;
  tamano: number;
}

export interface PaginaUsuarios {
  elementos: CuentaUsuario[];
  total: number;
}

/**
 * Puerto de salida de las cuentas. Las violaciones de unicidad (correo, documento, rol repetido)
 * llegan como ConflictoError con un código estable.
 */
export interface UsuarioRepository {
  buscarPorId(id: string): Promise<CuentaUsuario | null>;
  buscarPorEmail(email: string): Promise<CuentaUsuario | null>;
  buscarPorIdentidad(proveedor: ProveedorOidc, sujeto: string): Promise<CuentaUsuario | null>;
  crear(nuevo: NuevoUsuario): Promise<CuentaUsuario>;
  vincularIdentidad(usuarioId: string, proveedor: ProveedorOidc, sujeto: string): Promise<void>;
  /** Fija la contraseña, quita la obligación de cambiarla y, si se indica, verifica el correo. */
  actualizarPassword(id: string, hash: string | null, opciones?: { verificarCorreo?: boolean }): Promise<void>;
  marcarCorreoVerificado(id: string): Promise<void>;
  guardarMfa(id: string, secretoCifrado: string | null): Promise<void>;
  registrarIngreso(id: string, instante: Date): Promise<void>;
  actualizar(id: string, cambios: CambiosUsuario): Promise<void>;
  asignarRol(usuarioId: string, asignacion: AsignacionRol, asignadoPor: string): Promise<AsignacionGuardada>;
  revocarRol(usuarioId: string, asignacionId: string): Promise<boolean>;
  contarSuperadminsActivos(): Promise<number>;
  listar(filtro: FiltroUsuarios): Promise<PaginaUsuarios>;
}
