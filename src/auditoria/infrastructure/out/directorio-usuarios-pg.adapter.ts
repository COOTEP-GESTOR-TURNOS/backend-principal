import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { PG_POOL } from '../../../compartido/infrastructure/recursos';
import type { DirectorioUsuariosPort } from '../../application/ports/out/auditoria-lectura.port';

/** Nombres de los actores de una página de auditoría, en una sola consulta. */
@Injectable()
export class DirectorioUsuariosPgAdapter implements DirectorioUsuariosPort {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async buscar(ids: string[]): Promise<Map<string, { nombre: string; email: string }>> {
    // Los intentos fallidos de un correo desconocido usan el UUID nulo, que no está en usuario.
    const { rows } = await this.pool.query<{ id: string; nombre: string; email: string }>(
      'SELECT id, nombre, email FROM usuario WHERE id = ANY($1::uuid[])',
      [ids],
    );
    return new Map(rows.map((r) => [r.id, { nombre: r.nombre, email: r.email }]));
  }
}
