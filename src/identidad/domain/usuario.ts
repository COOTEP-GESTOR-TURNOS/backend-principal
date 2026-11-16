import type { AsignacionRol, Rol } from '../../compartido/domain/principal';

export type TipoDocumento = 'CC' | 'CE' | 'TI' | 'PA';
export const TIPOS_DOCUMENTO: readonly TipoDocumento[] = ['CC', 'CE', 'TI', 'PA'];

/** Asignación de rol ya guardada: lleva su identificador para poder revocarla. */
export interface AsignacionGuardada extends AsignacionRol {
  id: string;
  asignadoEn: Date;
}

/** Cuenta local. La contraseña y el secreto MFA solo viajan como hash y como texto cifrado. */
export interface CuentaUsuario {
  id: string;
  email: string;
  nombre: string;
  tipoDocumento: TipoDocumento | null;
  numeroDocumento: string | null;
  /** AAAA-MM-DD; sirve para reconocer a los adultos mayores (atención preferencial). */
  fechaNacimiento: string | null;
  passwordHash: string | null;
  mfaSecretoCifrado: string | null;
  debeCambiarPassword: boolean;
  emailVerificado: boolean;
  activo: boolean;
  creadoEn: Date;
  ultimoIngresoEn: Date | null;
  roles: AsignacionGuardada[];
}

/** Roles que exigen MFA (RF-03): el superadministrador y los administradores de agencia. */
export const ROLES_CON_MFA: readonly Rol[] = ['SUPERADMIN', 'ADMIN_AGENCIA'];

export function requiereMfa(roles: readonly AsignacionRol[]): boolean {
  return roles.some((r) => ROLES_CON_MFA.includes(r.rol));
}

/** El correo se guarda en minúsculas y sin espacios (lo exige un CHECK en PostgreSQL). */
export function normalizarCorreo(correo: string): string {
  return correo.trim().toLowerCase();
}

const PRIORIDAD: readonly Rol[] = ['SUPERADMIN', 'ADMIN_AGENCIA', 'FUNCIONARIO', 'ASOCIADO'];

/** Rol de mayor privilegio, para la auditoría y para elegir el panel inicial. */
export function rolPrincipal(roles: readonly AsignacionRol[]): Rol | 'SIN_ROL' {
  return PRIORIDAD.find((rol) => roles.some((r) => r.rol === rol)) ?? 'SIN_ROL';
}

/** Lo que el token de acceso lleva de cada asignación (sin identificadores internos). */
export function asignacionesParaToken(roles: readonly AsignacionRol[]): AsignacionRol[] {
  return roles.map(({ rol, agenciaId, servicioId }) => ({
    rol,
    ...(agenciaId ? { agenciaId } : {}),
    ...(servicioId ? { servicioId } : {}),
  }));
}
