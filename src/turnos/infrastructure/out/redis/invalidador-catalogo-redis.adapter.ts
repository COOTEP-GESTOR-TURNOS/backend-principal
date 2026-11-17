import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS } from '../../../../compartido/infrastructure/recursos';
import type { InvalidadorCatalogoPort } from '../../../application/ports/out/otros.ports';
import { CLAVE_AGENCIAS, prefijoFilasDe } from '../postgres/catalogo-pg.adapter';

/**
 * Borra las entradas de catálogo de CatalogoPgAdapter (cache-aside). Usa SCAN, que no bloquea
 * Redis como KEYS. Si Redis falla, el catálogo viejo vence solo a los 10 minutos.
 */
@Injectable()
export class InvalidadorCatalogoRedisAdapter implements InvalidadorCatalogoPort {
  private readonly logger = new Logger(InvalidadorCatalogoRedisAdapter.name);

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async invalidarAgencia(agenciaId: string): Promise<void> {
    await this.borrar(`cache:${prefijoFilasDe(agenciaId)}*`, `cache:${CLAVE_AGENCIAS}`);
  }

  async invalidarTodo(): Promise<void> {
    await this.borrar('cache:catalogo:*');
  }

  private async borrar(patron: string, ...extra: string[]): Promise<void> {
    try {
      const claves = [...extra];
      let cursor = '0';
      do {
        const [siguiente, encontradas] = await this.redis.scan(cursor, 'MATCH', patron, 'COUNT', 200);
        claves.push(...encontradas);
        cursor = siguiente;
      } while (cursor !== '0');
      if (claves.length > 0) await this.redis.del(...claves);
    } catch (error) {
      this.logger.warn(`No se pudo invalidar el catálogo (${patron}): ${String(error)}`);
    }
  }
}
