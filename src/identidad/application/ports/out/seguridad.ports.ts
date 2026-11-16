import type { AsignacionRol } from '../../../../compartido/domain/principal';

export const EMISOR_TOKENS = Symbol('EMISOR_TOKENS');
export const TOTP = Symbol('TOTP');
export const CIFRADOR = Symbol('CIFRADOR');
export const CORREO = Symbol('CORREO');

export interface TokenAcceso {
  token: string;
  jti: string;
  /** Segundos de vida (10 min). */
  expiraEn: number;
}

/** Firma el JWT de acceso con sub, roles con ámbito y métodos de autenticación. */
export interface EmisorTokensPort {
  emitirAcceso(usuarioId: string, roles: AsignacionRol[], amr: string[]): Promise<TokenAcceso>;
}

/** Códigos de un solo uso basados en tiempo (TOTP, RFC 6238), compatibles con Google Authenticator. */
export interface TotpPort {
  generarSecreto(): string;
  uriAprovisionamiento(secreto: string, cuenta: string): string;
  /** Imagen QR (data URL PNG) de la URI, para escanearla con la app autenticadora. */
  qr(uri: string): Promise<string>;
  verificar(secreto: string, codigo: string, instante: Date): boolean;
}

/** Cifrado autenticado de secretos en reposo (AES-256-GCM). */
export interface CifradorPort {
  cifrar(texto: string): string;
  descifrar(cifrado: string): string;
}

export interface MensajeCorreo {
  para: string;
  asunto: string;
  texto: string;
  html: string;
}

export interface CorreoPort {
  enviar(mensaje: MensajeCorreo): Promise<void>;
}
