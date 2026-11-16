import { ForbiddenException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { leerConfig } from '../../../../compartido/infrastructure/config';
import type { Cliente } from '../../../application/ports/out/sesiones.port';

/** Cookie de renovación de la web: HttpOnly, SameSite=Strict y limitada a /api/v1/auth. */
export const COOKIE_SESION = 'cootep_sesion';
const RUTA = '/api/v1/auth';
const DOCE_HORAS_MS = 12 * 60 * 60 * 1000;

/**
 * Cabecera anti-CSRF: un formulario de otro sitio no puede enviar cabeceras propias sin pasar
 * por CORS, así que exigirla en las peticiones que usan la cookie bloquea los envíos ajenos.
 */
export const CABECERA_CSRF = 'x-cootep-csrf';

/** La app móvil se identifica con X-Cliente: movil y recibe los tokens en el cuerpo. */
export function clienteDe(peticion: Request): Cliente {
  return peticion.header('x-cliente') === 'movil' ? 'movil' : 'web';
}

export function fijarCookieSesion(respuesta: Response, token: string): void {
  respuesta.cookie(COOKIE_SESION, token, {
    httpOnly: true,
    secure: leerConfig().cookieSegura,
    sameSite: 'strict',
    path: RUTA,
    maxAge: DOCE_HORAS_MS,
  });
}

export function borrarCookieSesion(respuesta: Response): void {
  respuesta.clearCookie(COOKIE_SESION, { httpOnly: true, secure: leerConfig().cookieSegura, sameSite: 'strict', path: RUTA });
}

/** Lee la cookie sin depender de cookie-parser. */
export function leerCookieSesion(peticion: Request): string | undefined {
  const cabecera = peticion.header('cookie') ?? '';
  for (const parte of cabecera.split(';')) {
    const [nombre, ...valor] = parte.trim().split('=');
    if (nombre === COOKIE_SESION) return decodeURIComponent(valor.join('='));
  }
  return undefined;
}

/** Token de renovación: de la cookie (web, con cabecera anti-CSRF) o del cuerpo (móvil). */
export function tokenRenovacionDe(peticion: Request, delCuerpo?: string): string | undefined {
  if (clienteDe(peticion) === 'movil') return delCuerpo;
  const cookie = leerCookieSesion(peticion);
  if (cookie && peticion.header(CABECERA_CSRF) !== '1') {
    throw new ForbiddenException('Falta la cabecera anti-CSRF');
  }
  return cookie;
}
