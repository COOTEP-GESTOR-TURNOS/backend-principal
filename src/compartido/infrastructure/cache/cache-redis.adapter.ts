import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import type { CachePort } from '../../application/ports/cache.port';
import { REDIS } from '../recursos';

interface MetricasPrefijo {
  aciertos: number;
  fallos: number;
  errores: number;
  latenciaTotalMs: number;
  lecturas: number;
}

/**
 * Cache-aside en Redis. Todas las claves llevan el prefijo cache: (las sesiones usan sess:).
 * Si Redis falla, se responde como un fallo de caché y la petición sigue contra el origen.
 */
@Injectable()
export class CacheRedisAdapter implements CachePort {
  private readonly logger = new Logger(CacheRedisAdapter.name);
  private readonly metricas = new Map<string, MetricasPrefijo>();

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async obtener<T>(clave: string): Promise<T | null> {
    const inicio = performance.now();
    const m = this.metricasDe(clave);
    try {
      const valor = await this.redis.get(`cache:${clave}`);
      if (valor === null) m.fallos++;
      else m.aciertos++;
      return valor === null ? null : (JSON.parse(valor) as T);
    } catch (error) {
      m.errores++;
      this.logger.warn(`Caché no disponible: ${String(error)}`);
      return null;
    } finally {
      m.lecturas++;
      m.latenciaTotalMs += performance.now() - inicio;
    }
  }

  async guardar<T>(clave: string, valor: T, ttlSegundos: number): Promise<void> {
    try {
      await this.redis.set(`cache:${clave}`, JSON.stringify(valor), 'EX', ttlSegundos);
    } catch (error) {
      this.logger.warn(`No se pudo guardar en caché: ${String(error)}`);
    }
  }

  async invalidar(clave: string): Promise<void> {
    await this.redis.del(`cache:${clave}`).catch(() => undefined);
  }

  /** Aciertos, fallos y latencia media por prefijo, para /api/v1/metricas. */
  resumen(): Record<string, { aciertos: number; fallos: number; errores: number; latenciaMediaMs: number }> {
    const salida: Record<string, { aciertos: number; fallos: number; errores: number; latenciaMediaMs: number }> = {};
    for (const [prefijo, m] of this.metricas) {
      salida[prefijo] = {
        aciertos: m.aciertos,
        fallos: m.fallos,
        errores: m.errores,
        latenciaMediaMs: m.lecturas ? Number((m.latenciaTotalMs / m.lecturas).toFixed(2)) : 0,
      };
    }
    return salida;
  }

  private metricasDe(clave: string): MetricasPrefijo {
    const prefijo = clave.split(':')[0];
    let m = this.metricas.get(prefijo);
    if (!m) {
      m = { aciertos: 0, fallos: 0, errores: 0, latenciaTotalMs: 0, lecturas: 0 };
      this.metricas.set(prefijo, m);
    }
    return m;
  }
}
