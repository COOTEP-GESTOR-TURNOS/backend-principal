import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { PG_POOL } from '../../../../compartido/infrastructure/recursos';
import type {
  AgenciasAdminRepository,
  ConfiguracionAgencia,
  ServicioAgencia,
} from '../../../application/ports/out/agencias-admin.repository';

/** Adaptador de salida de la configuración de agencias sobre PostgreSQL (fuente de verdad del catálogo). */
@Injectable()
export class AgenciasAdminPgRepository implements AgenciasAdminRepository {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async obtener(agenciaId: string): Promise<ConfiguracionAgencia | null> {
    const { rows } = await this.pool.query<{
      id: string;
      codigo: string;
      nombre: string;
      municipio: string;
      activa: boolean;
      servicios: ServicioAgencia[];
      parametros: Record<string, string>;
    }>(
      `SELECT a.id, a.codigo, a.nombre, a.municipio, a.activa,
              COALESCE((SELECT json_agg(json_build_object(
                         'servicioId', s.id, 'codigo', s.codigo, 'nombre', s.nombre, 'prefijo', s.prefijo_turno,
                         'ventanillas', x.ventanillas, 'activo', x.activo) ORDER BY s.codigo)
                          FROM agencia_servicio x JOIN servicio s ON s.id = x.servicio_id
                         WHERE x.agencia_id = a.id), '[]') AS servicios,
              COALESCE((SELECT json_object_agg(p.clave, p.valor) FROM parametro p WHERE p.agencia_id = a.id), '{}') AS parametros
         FROM agencia a
        WHERE a.id = $1`,
      [agenciaId],
    );
    if (!rows[0]) return null;
    return { ...rows[0], servicios: rows[0].servicios.map((s) => ({ ...s, prefijo: s.prefijo.trim() })) };
  }

  async parametrosGlobales(): Promise<Record<string, string>> {
    const { rows } = await this.pool.query<{ clave: string; valor: string }>('SELECT clave, valor FROM parametro WHERE agencia_id IS NULL');
    return Object.fromEntries(rows.map((r) => [r.clave, r.valor]));
  }

  async actualizarServicio(
    agenciaId: string,
    servicioId: string,
    cambios: { ventanillas?: number; activo?: boolean },
    actorId: string,
  ): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `UPDATE agencia_servicio
          SET ventanillas = COALESCE($3, ventanillas),
              activo = COALESCE($4, activo),
              actualizado_en = now(),
              actualizado_por = $5
        WHERE agencia_id = $1 AND servicio_id = $2`,
      [agenciaId, servicioId, cambios.ventanillas ?? null, cambios.activo ?? null, actorId],
    );
    return (rowCount ?? 0) > 0;
  }

  async actualizarAgencia(agenciaId: string, cambios: { activa: boolean }): Promise<void> {
    await this.pool.query('UPDATE agencia SET activa = $2 WHERE id = $1', [agenciaId, cambios.activa]);
  }

  async fijarParametro(clave: string, agenciaId: string | null, valor: string, actorId: string): Promise<void> {
    // ux_parametro es NULLS NOT DISTINCT: el global (agencia NULL) también es único por clave.
    await this.pool.query(
      `INSERT INTO parametro (clave, agencia_id, valor, actualizado_por, actualizado_en)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (clave, agencia_id) DO UPDATE
         SET valor = EXCLUDED.valor, actualizado_por = EXCLUDED.actualizado_por, actualizado_en = now()`,
      [clave, agenciaId, valor, actorId],
    );
  }

  async quitarParametro(clave: string, agenciaId: string): Promise<boolean> {
    const { rowCount } = await this.pool.query('DELETE FROM parametro WHERE clave = $1 AND agencia_id = $2', [clave, agenciaId]);
    return (rowCount ?? 0) > 0;
  }
}
