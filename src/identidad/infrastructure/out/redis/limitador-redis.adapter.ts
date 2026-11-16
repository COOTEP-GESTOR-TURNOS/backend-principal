import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS } from '../../../../compartido/infrastructure/recursos';
import type { LimitadorPort } from '../../../application/ports/out/sesiones.port';

/**
 * Contador de intentos con ventana fija: INCR y, en el primer fallo, EXPIRE. Es atómico, así que
 * varias peticiones simultáneas no pueden saltarse el límite (login:intentos:{correo}:{ip}).
 */
@Injectable()
export class LimitadorRedisAdapter implements LimitadorPort {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async bloqueadoPor(clave: string, maximo: number): Promise<number> {
    const [intentos, ttl] = await Promise.all([this.redis.get(clave), this.redis.ttl(clave)]);
    return Number(intentos ?? 0) >= maximo && ttl > 0 ? ttl : 0;
  }

  async registrarFallo(clave: string, ventanaSegundos: number): Promise<number> {
    const [[, intentos]] = (await this.redis
      .multi()
      .incr(clave)
      .expire(clave, ventanaSegundos, 'NX')
      .exec()) as [[Error | null, number], [Error | null, number]];
    return intentos;
  }

  async reiniciar(clave: string): Promise<void> {
    await this.redis.del(clave);
  }
}
