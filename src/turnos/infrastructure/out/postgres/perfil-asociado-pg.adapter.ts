import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { PG_POOL } from '../../../../compartido/infrastructure/recursos';
import type { PerfilAsociadoPort } from '../../../application/ports/out/otros.ports';

@Injectable()
export class PerfilAsociadoPgAdapter implements PerfilAsociadoPort {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async fechaNacimiento(asociadoId: string): Promise<Date | null> {
    const { rows } = await this.pool.query<{ fecha_nacimiento: string | null }>(
      'SELECT fecha_nacimiento FROM usuario WHERE id = $1',
      [asociadoId],
    );
    const fecha = rows[0]?.fecha_nacimiento;
    return fecha ? new Date(`${fecha}T00:00:00Z`) : null;
  }
}
