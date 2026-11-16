import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS } from '../../../../compartido/infrastructure/recursos';
import type { AlmacenTemporalPort } from '../../../application/ports/out/sesiones.port';

/** Datos efímeros con TTL en Redis (retos de MFA, estados OIDC, enlaces). Todo va en JSON. */
@Injectable()
export class AlmacenTemporalRedisAdapter implements AlmacenTemporalPort {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async guardar<T>(clave: string, valor: T, ttlSegundos: number): Promise<void> {
    await this.redis.set(clave, JSON.stringify(valor), 'EX', ttlSegundos);
  }

  async obtener<T>(clave: string): Promise<T | null> {
    const valor = await this.redis.get(clave);
    return valor === null ? null : (JSON.parse(valor) as T);
  }

  async consumir<T>(clave: string): Promise<T | null> {
    const valor = await this.redis.getdel(clave);
    return valor === null ? null : (JSON.parse(valor) as T);
  }

  async eliminar(clave: string): Promise<void> {
    await this.redis.del(clave);
  }

  async guardarSiNoExiste(clave: string, ttlSegundos: number): Promise<boolean> {
    return (await this.redis.set(clave, '1', 'EX', ttlSegundos, 'NX')) === 'OK';
  }
}
