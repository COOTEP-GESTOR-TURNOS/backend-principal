import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { createHash, randomBytes } from 'node:crypto';
import { claveRevocado } from '../../../../compartido/infrastructure/auth/verificador-tokens';
import { REDIS } from '../../../../compartido/infrastructure/recursos';
import type { Sesion, SesionesPort } from '../../../application/ports/out/sesiones.port';

/** 30 minutos sin uso cierran la sesión; nunca dura más de 12 horas (sección 9 del informe). */
export const INACTIVIDAD_SEG = 30 * 60;
export const DURACION_MAXIMA_MS = 12 * 60 * 60 * 1000;

const hash = (token: string) => createHash('sha256').update(token).digest('base64url');
const claveSesion = (h: string) => `sess:${h}`;
const claveDelUsuario = (usuarioId: string) => `sess:usuario:${usuarioId}`;

/**
 * Sesiones de renovación en Redis. La clave es el hash del token: si alguien lee Redis no obtiene
 * tokens utilizables. Cada usuario tiene un conjunto con sus sesiones para cerrarlas todas.
 */
@Injectable()
export class SesionesRedisAdapter implements SesionesPort {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async crear(sesion: Sesion): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    const h = hash(token);
    await this.redis
      .multi()
      .set(claveSesion(h), JSON.stringify(sesion), 'EX', INACTIVIDAD_SEG)
      .sadd(claveDelUsuario(sesion.usuarioId), h)
      .expire(claveDelUsuario(sesion.usuarioId), DURACION_MAXIMA_MS / 1000)
      .exec();
    return token;
  }

  async rotar(token: string): Promise<{ token: string; sesion: Sesion } | null> {
    const h = hash(token);
    // GETDEL: dos renovaciones simultáneas con el mismo token no pueden ganar las dos.
    const guardada = await this.redis.getdel(claveSesion(h));
    if (!guardada) return null;
    const sesion = JSON.parse(guardada) as Sesion;
    await this.redis.srem(claveDelUsuario(sesion.usuarioId), h);
    if (Date.now() - sesion.creadaEn > DURACION_MAXIMA_MS) return null;
    return { token: await this.crear(sesion), sesion };
  }

  async cerrar(token: string): Promise<void> {
    const h = hash(token);
    const guardada = await this.redis.getdel(claveSesion(h));
    if (guardada) await this.redis.srem(claveDelUsuario((JSON.parse(guardada) as Sesion).usuarioId), h);
  }

  async cerrarTodas(usuarioId: string): Promise<void> {
    const hashes = await this.redis.smembers(claveDelUsuario(usuarioId));
    await this.redis.del(...hashes.map(claveSesion), claveDelUsuario(usuarioId));
  }

  async revocarAcceso(jti: string, segundosRestantes: number): Promise<void> {
    await this.redis.set(claveRevocado(jti), '1', 'EX', Math.max(1, Math.ceil(segundosRestantes)));
  }
}
