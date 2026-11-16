export const SESIONES = Symbol('SESIONES');
export const ALMACEN_TEMPORAL = Symbol('ALMACEN_TEMPORAL');
export const LIMITADOR = Symbol('LIMITADOR');

export type Cliente = 'web' | 'movil';

export interface Sesion {
  usuarioId: string;
  cliente: Cliente;
  /** Métodos con los que se autenticó: pwd (contraseña), otp (MFA), fed (Google). */
  amr: string[];
  /** Milisegundos desde 1970; la sesión no pasa de 12 h aunque se renueve. */
  creadaEn: number;
}

/**
 * Sesiones de renovación (sección 9 del informe): token opaco que rota en cada uso,
 * caduca a los 30 min sin uso o a las 12 h. Solo se guarda su hash.
 */
export interface SesionesPort {
  crear(sesion: Sesion): Promise<string>;
  /** Invalida el token recibido y entrega uno nuevo para la misma sesión; null si no es válido. */
  rotar(token: string): Promise<{ token: string; sesion: Sesion } | null>;
  cerrar(token: string): Promise<void>;
  /** Cierra todas las sesiones del usuario (cambio de contraseña, desactivación, MFA restablecido). */
  cerrarTodas(usuarioId: string): Promise<void>;
  /** Marca el jti del token de acceso como revocado hasta que venza. */
  revocarAcceso(jti: string, segundosRestantes: number): Promise<void>;
}

/** Datos efímeros con vencimiento: retos de MFA, estados OIDC y enlaces de un solo uso. */
export interface AlmacenTemporalPort {
  guardar<T>(clave: string, valor: T, ttlSegundos: number): Promise<void>;
  obtener<T>(clave: string): Promise<T | null>;
  /** Lee y borra en una sola operación: así un enlace o un código no se usan dos veces. */
  consumir<T>(clave: string): Promise<T | null>;
  eliminar(clave: string): Promise<void>;
  /** Guarda solo si no existe; false si ya estaba (evita reutilizar un código TOTP). */
  guardarSiNoExiste(clave: string, ttlSegundos: number): Promise<boolean>;
}

/** Contador de intentos fallidos con ventana fija. */
export interface LimitadorPort {
  /** Segundos que faltan para desbloquear, o 0 si no está bloqueado. */
  bloqueadoPor(clave: string, maximo: number): Promise<number>;
  registrarFallo(clave: string, ventanaSegundos: number): Promise<number>;
  reiniciar(clave: string): Promise<void>;
}
