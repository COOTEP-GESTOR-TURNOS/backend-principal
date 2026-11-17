import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { REDIS } from '../../../../compartido/infrastructure/recursos';
import type { CerrojoPort } from '../../../application/ports/out/otros.ports';

/** Borra el cerrojo solo si sigue siendo nuestro: así no se suelta el que tomó otra instancia. */
const SOLTAR_SI_ES_MIO = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0`;

/**
 * Cerrojo distribuido con SET NX EX: cerrojo:{nombre} guarda un token propio de esta instancia
 * y vence solo si la instancia se cae a mitad del ciclo.
 */
@Injectable()
export class CerrojoRedisAdapter implements CerrojoPort {
  private readonly propios = new Map<string, string>();

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async tomar(nombre: string, ttlSegundos: number): Promise<boolean> {
    const token = randomUUID();
    const ok = (await this.redis.set(`cerrojo:${nombre}`, token, 'EX', ttlSegundos, 'NX')) === 'OK';
    if (ok) this.propios.set(nombre, token);
    return ok;
  }

  async soltar(nombre: string): Promise<void> {
    const token = this.propios.get(nombre);
    if (!token) return;
    this.propios.delete(nombre);
    await this.redis.eval(SOLTAR_SI_ES_MIO, 1, `cerrojo:${nombre}`, token);
  }
}
