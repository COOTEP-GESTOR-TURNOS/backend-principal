import { Module } from '@nestjs/common';
import { AUDIT_LOG } from './application/ports/out/audit-log.port';
import { AuditCassandraAdapter } from './infrastructure/out/audit-cassandra.adapter';

/**
 * Pendiente: usar AUDIT_LOG desde los casos de uso administrativos (cambios de rol, parámetros,
 * cierres de agencia) y exponer GET /api/v1/admin/auditoria para el superadministrador.
 */
@Module({
  providers: [{ provide: AUDIT_LOG, useClass: AuditCassandraAdapter }],
  exports: [AUDIT_LOG],
})
export class AuditoriaModule {}
