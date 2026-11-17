import { Module } from '@nestjs/common';
import { CATALOGO, type CatalogoPort, RELOJ, type RelojPort } from '../turnos/application/ports/out/otros.ports';
import { TurnosModule } from '../turnos/turnos.module';
import { CONSULTAR_AUDITORIA } from './application/ports/in/consultar-auditoria.use-case';
import { AUDIT_LOG } from './application/ports/out/audit-log.port';
import {
  AUDITORIA_LECTURA,
  type AuditoriaLecturaPort,
  DIRECTORIO_USUARIOS,
  type DirectorioUsuariosPort,
} from './application/ports/out/auditoria-lectura.port';
import { ConsultarAuditoriaService } from './application/use-cases/consultar-auditoria.service';
import { AuditoriaController } from './infrastructure/in/http/auditoria.controller';
import { AuditCassandraAdapter } from './infrastructure/out/audit-cassandra.adapter';
import { AuditoriaLecturaCassandraAdapter } from './infrastructure/out/auditoria-lectura-cassandra.adapter';
import { DirectorioUsuariosPgAdapter } from './infrastructure/out/directorio-usuarios-pg.adapter';

/**
 * Auditoría en Cassandra: los casos de uso escriben con AUDIT_LOG (solo inserción) y el
 * superadministrador la consulta por ámbito y día o por persona y mes (RF-20, CU-06).
 */
@Module({
  imports: [TurnosModule],
  controllers: [AuditoriaController],
  providers: [
    { provide: AUDIT_LOG, useClass: AuditCassandraAdapter },
    { provide: AUDITORIA_LECTURA, useClass: AuditoriaLecturaCassandraAdapter },
    { provide: DIRECTORIO_USUARIOS, useClass: DirectorioUsuariosPgAdapter },
    {
      provide: CONSULTAR_AUDITORIA,
      useFactory: (lectura: AuditoriaLecturaPort, directorio: DirectorioUsuariosPort, catalogo: CatalogoPort, reloj: RelojPort) =>
        new ConsultarAuditoriaService(lectura, directorio, catalogo, reloj),
      inject: [AUDITORIA_LECTURA, DIRECTORIO_USUARIOS, CATALOGO, RELOJ],
    },
  ],
  exports: [AUDIT_LOG],
})
export class AuditoriaModule {}
