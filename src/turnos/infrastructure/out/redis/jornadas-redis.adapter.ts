import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS } from '../../../../compartido/infrastructure/recursos';
import type { JornadasPort } from '../../../application/ports/out/otros.ports';

/** Vence sola al día siguiente: la marca solo vale para la fecha en que se cerró. */
const TTL_SEG = 36 * 60 * 60;

/** jornada:cerrada:{agencia}:{fecha} en Redis; la consultan todas las instancias del backend. */
@Injectable()
export class JornadasRedisAdapter implements JornadasPort {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async cerrar(agenciaId: string, fecha: string): Promise<void> {
    await this.redis.set(this.clave(agenciaId, fecha), new Date().toISOString(), 'EX', TTL_SEG);
  }

  async reabrir(agenciaId: string, fecha: string): Promise<boolean> {
    return (await this.redis.del(this.clave(agenciaId, fecha))) > 0;
  }

  async estaCerrada(agenciaId: string, fecha: string): Promise<boolean> {
    return (await this.redis.exists(this.clave(agenciaId, fecha))) === 1;
  }

  private clave(agenciaId: string, fecha: string): string {
    return `jornada:cerrada:${agenciaId}:${fecha}`;
  }
}
