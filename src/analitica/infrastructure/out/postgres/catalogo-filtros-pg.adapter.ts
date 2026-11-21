import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { PG_POOL } from '../../../../compartido/infrastructure/recursos';
import type {
  CatalogoFiltrosPort, ColaboradorAnalitica, ColaboradorVigente, OfertaAnalitica,
} from '../../../application/ports/out/catalogo-filtros.port';

@Injectable()
export class CatalogoFiltrosPgAdapter implements CatalogoFiltrosPort {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async ofertas(agenciaIds: string[]): Promise<OfertaAnalitica[]> {
    const { rows } = await this.pool.query<OfertaAnalitica>(
      `SELECT x.agencia_id AS "agenciaId", s.id AS "servicioId", s.nombre,
              (a.activa AND s.activo AND x.activo) AS activa
         FROM agencia_servicio x
         JOIN servicio s ON s.id = x.servicio_id
         JOIN agencia a ON a.id = x.agencia_id
        WHERE x.agencia_id = ANY($1::uuid[])`,
      [agenciaIds],
    );
    return rows;
  }

  async colaboradoresVigentes(agenciaIds: string[], servicioId?: string): Promise<ColaboradorVigente[]> {
    const { rows } = await this.pool.query<ColaboradorVigente>(
      `SELECT DISTINCT u.id, u.nombre, r.agencia_id AS "agenciaId"
         FROM usuario u
         JOIN asignacion_rol r ON r.usuario_id = u.id
         JOIN agencia a ON a.id = r.agencia_id
         JOIN agencia_servicio x ON x.agencia_id = a.id AND x.activo
         JOIN servicio s ON s.id = x.servicio_id AND s.activo
        WHERE u.activo AND a.activa AND r.rol IN ('ADMIN_AGENCIA', 'FUNCIONARIO')
          AND r.agencia_id = ANY($1::uuid[])
          AND (r.servicio_id IS NULL OR r.servicio_id = s.id)
          AND ($2::uuid IS NULL OR s.id = $2)`,
      [agenciaIds, servicioId ?? null],
    );
    return rows;
  }

  async nombresColaboradores(ids: string[]): Promise<ColaboradorAnalitica[]> {
    if (!ids.length) return [];
    const { rows } = await this.pool.query<ColaboradorAnalitica>(
      'SELECT id, nombre FROM usuario WHERE id = ANY($1::uuid[])',
      [ids],
    );
    return rows;
  }

  async nombresServicios(ids: string[]): Promise<{ id: string; nombre: string }[]> {
    if (!ids.length) return [];
    const { rows } = await this.pool.query<{ id: string; nombre: string }>(
      'SELECT id, nombre FROM servicio WHERE id = ANY($1::uuid[])',
      [ids],
    );
    return rows;
  }
}
