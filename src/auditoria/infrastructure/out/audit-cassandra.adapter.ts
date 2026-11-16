import { Inject, Injectable, Logger } from '@nestjs/common';
import { Client as ClienteCassandra, types } from 'cassandra-driver';
import { fechaLocal } from '../../../compartido/domain/tiempo';
import { CASSANDRA } from '../../../compartido/infrastructure/recursos';
import type { AuditLogPort, EntradaAuditoria } from '../../application/ports/out/audit-log.port';

/**
 * Escribe cada entrada en las dos tablas de consulta de Cassandra con un lote atómico.
 * Si Cassandra no responde, el error queda en el registro del servicio y la operación sigue:
 * un inicio de sesión no debe fallar porque la auditoría esté caída.
 */
@Injectable()
export class AuditCassandraAdapter implements AuditLogPort {
  private readonly logger = new Logger(AuditCassandraAdapter.name);

  constructor(@Inject(CASSANDRA) private readonly cassandra: ClienteCassandra) {}

  async registrar(e: EntradaAuditoria): Promise<void> {
    const ahora = new Date();
    const ocurridoEn = types.TimeUuid.fromDate(ahora);
    const dia = fechaLocal(ahora);
    try {
      await this.cassandra.batch(
        [
          {
            query: `INSERT INTO auditoria_por_ambito_dia
                      (ambito, dia, ocurrido_en, actor_id, actor_rol, accion, objetivo_tipo, objetivo_id, detalle, ip)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            params: [e.ambito, dia, ocurridoEn, e.actorId, e.actorRol, e.accion, e.objetivoTipo, e.objetivoId,
                     JSON.stringify(e.detalle ?? {}), e.ip ?? null],
          },
          {
            query: `INSERT INTO auditoria_por_actor (actor_id, mes, ocurrido_en, accion, ambito, objetivo_id)
                    VALUES (?, ?, ?, ?, ?, ?)`,
            params: [e.actorId, dia.slice(0, 7), ocurridoEn, e.accion, e.ambito, e.objetivoId],
          },
        ],
        { prepare: true },
      );
    } catch (error) {
      this.logger.error(`No se pudo auditar ${e.accion} de ${e.actorId}: ${String(error)}`);
    }
  }
}
