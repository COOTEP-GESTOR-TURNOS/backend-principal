import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { CACHE, CachePort } from '../../../../compartido/application/ports/cache.port';
import { PG_POOL } from '../../../../compartido/infrastructure/recursos';
import type { CatalogoPort } from '../../../application/ports/out/otros.ports';
import { Fila } from '../../../domain/fila';

interface DatosFila {
  agenciaId: string;
  servicioId: string;
  prefijo: string;
  ventanillas: number;
  activa: boolean;
  parametros: Record<string, string>;
}

/** 10 minutos: el catálogo cambia muy poco y se consulta en cada solicitud de turno. */
const TTL_CATALOGO_SEGUNDOS = 600;

/** Adaptador de salida: catálogo y parámetros desde PostgreSQL, con cache-aside en Redis. */
@Injectable()
export class CatalogoPgAdapter implements CatalogoPort {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(CACHE) private readonly cache: CachePort,
  ) {}

  async obtenerFila(agenciaId: string, servicioId: string): Promise<Fila | null> {
    const clave = `catalogo:fila:${agenciaId}:${servicioId}`;
    let datos = await this.cache.obtener<DatosFila>(clave);
    if (!datos) {
      datos = await this.leerDePostgres(agenciaId, servicioId);
      if (!datos) return null;
      await this.cache.guardar(clave, datos, TTL_CATALOGO_SEGUNDOS);
    }
    const p = datos.parametros;
    return new Fila(
      datos.agenciaId,
      datos.servicioId,
      datos.prefijo,
      datos.ventanillas,
      { apertura: p.HORARIO_APERTURA ?? '08:00', cierre: p.HORARIO_CIERRE ?? '16:00' },
      {
        nProximo: Number(p.N_PROXIMO ?? 3),
        maxPreferencialesSeguidos: Number(p.MAX_PREFERENCIALES_SEGUIDOS ?? 2),
        edadAdultoMayor: Number(p.EDAD_ADULTO_MAYOR ?? 60),
      },
      datos.activa,
    );
  }

  private async leerDePostgres(agenciaId: string, servicioId: string): Promise<DatosFila | null> {
    const fila = await this.pool.query<{ activa: boolean; prefijo: string; ventanillas: number }>(
      `SELECT (a.activa AND s.activo) AS activa, s.prefijo_turno AS prefijo, x.ventanillas
         FROM agencia_servicio x
         JOIN agencia a ON a.id = x.agencia_id
         JOIN servicio s ON s.id = x.servicio_id
        WHERE x.agencia_id = $1 AND x.servicio_id = $2`,
      [agenciaId, servicioId],
    );
    if (fila.rowCount === 0) return null;

    // Parámetros globales y de la agencia; los de la agencia ganan.
    const parametros = await this.pool.query<{ clave: string; valor: string; agencia_id: string | null }>(
      'SELECT clave, valor, agencia_id FROM parametro WHERE agencia_id = $1 OR agencia_id IS NULL ORDER BY agencia_id NULLS FIRST',
      [agenciaId],
    );
    const mapa: Record<string, string> = {};
    for (const p of parametros.rows) mapa[p.clave] = p.valor;

    const { activa, prefijo, ventanillas } = fila.rows[0];
    return { agenciaId, servicioId, prefijo: prefijo.trim(), ventanillas, activa, parametros: mapa };
  }
}
