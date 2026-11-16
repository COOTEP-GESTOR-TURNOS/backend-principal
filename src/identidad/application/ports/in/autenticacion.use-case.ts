import type { AsignacionRol } from '../../../../compartido/domain/principal';
import type { CuentaUsuario, TipoDocumento } from '../../../domain/usuario';
import type { Cliente } from '../out/sesiones.port';

export const AUTENTICACION = Symbol('AUTENTICACION');

export type PasoPendiente = 'CAMBIAR_CLAVE' | 'CONFIGURAR_MFA' | 'VERIFICAR_MFA';

export interface PerfilUsuario {
  id: string;
  email: string;
  nombre: string;
  tipoDocumento: TipoDocumento | null;
  numeroDocumento: string | null;
  fechaNacimiento: string | null;
  roles: AsignacionRol[];
  mfaActivo: boolean;
  tienePassword: boolean;
  /** Falta el documento (cuentas creadas con Google): la web pide completarlo. */
  perfilCompleto: boolean;
}

export interface SesionEmitida {
  tokenAcceso: string;
  /** Segundos de vida del token de acceso. */
  expiraEn: number;
  tokenRenovacion: string;
  usuario: PerfilUsuario;
}

export type ResultadoIngreso =
  | { estado: 'SESION_INICIADA'; sesion: SesionEmitida }
  | { estado: 'PASO_PENDIENTE'; reto: string; paso: PasoPendiente; nombre: string };

export interface ConfiguracionMfa {
  secreto: string;
  uri: string;
  qr: string;
}

/** Puerto de entrada: inicio de sesión local, pasos pendientes (clave, MFA) y ciclo de la sesión. */
export interface AutenticacionUseCase {
  iniciarSesion(cmd: { correo: string; clave: string; ip: string; cliente: Cliente }): Promise<ResultadoIngreso>;
  /** Continúa con una cuenta ya identificada (por ejemplo, con Google): pide MFA si su rol lo exige. */
  continuar(cuenta: CuentaUsuario, cliente: Cliente, amr: string[]): Promise<ResultadoIngreso>;
  cambiarClaveInicial(cmd: { reto: string; claveNueva: string }): Promise<ResultadoIngreso>;
  prepararMfa(reto: string): Promise<ConfiguracionMfa>;
  verificarMfa(cmd: { reto: string; codigo: string; ip: string }): Promise<ResultadoIngreso>;
  renovar(tokenRenovacion: string): Promise<SesionEmitida>;
  cerrarSesion(cmd: { tokenRenovacion?: string; acceso?: { jti?: string; expira?: number } }): Promise<void>;
  perfil(usuarioId: string): Promise<PerfilUsuario>;
}
