import type { TipoDocumento } from '../../../domain/usuario';

export const CUENTAS = Symbol('CUENTAS');

export interface DatosRegistro {
  email: string;
  nombre: string;
  tipoDocumento: TipoDocumento;
  numeroDocumento: string;
  fechaNacimiento?: string | null;
  clave: string;
}

export interface CambiosPerfil {
  nombre?: string;
  tipoDocumento?: TipoDocumento;
  numeroDocumento?: string;
  fechaNacimiento?: string | null;
}

/** Puerto de entrada: registro de asociados, verificación de correo, recuperación y datos propios. */
export interface CuentasUseCase {
  /** Registro público: solo crea asociados. Las cuentas con privilegios las crea un administrador. */
  registrar(datos: DatosRegistro): Promise<{ id: string; email: string }>;
  verificarCorreo(token: string): Promise<void>;
  /** Siempre responde igual, exista o no la cuenta, para no revelar qué correos están registrados. */
  reenviarVerificacion(correo: string): Promise<void>;
  solicitarRecuperacion(correo: string): Promise<void>;
  /** Fija la contraseña con un enlace de recuperación o de activación y cierra las demás sesiones. */
  restablecerClave(cmd: { token: string; claveNueva: string }): Promise<void>;
  /** Envía el enlace de activación a una cuenta creada por un administrador. */
  enviarActivacion(usuarioId: string, rolTexto: string): Promise<void>;
  cambiarClave(usuarioId: string, cmd: { claveActual?: string; claveNueva: string }): Promise<void>;
  actualizarPerfil(usuarioId: string, cambios: CambiosPerfil): Promise<void>;
}
