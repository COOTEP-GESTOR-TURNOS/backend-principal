/** Límites y vencimientos del módulo de identidad (sección 9 del informe). */
export const LIMITES = {
  /** CU-01: 5 intentos fallidos por correo e IP bloquean 15 minutos (respuesta 429). */
  intentosLogin: 5,
  ventanaLoginSeg: 15 * 60,
  /** Códigos MFA equivocados antes de anular el reto y volver a pedir la contraseña. */
  intentosMfa: 5,
  /** Tiempo para completar los pasos pendientes (cambiar clave, configurar o verificar MFA). */
  retoSeg: 10 * 60,
  /** RF-04: enlace de recuperación de un solo uso, 15 minutos. */
  recuperarSeg: 15 * 60,
  /** Enlace para que una cuenta creada por un administrador defina su contraseña. */
  activarSeg: 72 * 60 * 60,
  verificarCorreoSeg: 24 * 60 * 60,
  /** Correos de recuperación o verificación por dirección en la ventana (evita usar el sistema para spam). */
  correosPorVentana: 3,
  ventanaCorreosSeg: 15 * 60,
  /** Estado, nonce y verificador PKCE del inicio con Google. */
  oidcEstadoSeg: 10 * 60,
  /** Código que la app móvil canjea por sus tokens al volver del navegador. */
  canjeMovilSeg: 60,
  /** Un código TOTP vale 30 s con tolerancia de ±1 paso: se recuerda 90 s para no aceptarlo dos veces. */
  totpUsadoSeg: 90,
} as const;

export type PropositoEnlace = 'RECUPERAR' | 'ACTIVAR' | 'VERIFICAR_CORREO';
