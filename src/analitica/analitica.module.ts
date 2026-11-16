import { Module } from '@nestjs/common';
import { AUDIT_LOG, type AuditLogPort } from '../auditoria/application/ports/out/audit-log.port';
import { AuditoriaModule } from '../auditoria/auditoria.module';
import { CACHE, type CachePort } from '../compartido/application/ports/cache.port';
import { CATALOGO, type CatalogoPort, RELOJ, type RelojPort } from '../turnos/application/ports/out/otros.ports';
import { TurnosModule } from '../turnos/turnos.module';
import { CONSULTAR_INDICADORES } from './application/ports/in/consultar-indicadores.use-case';
import { CONSULTAR_RECOMENDACIONES } from './application/ports/in/consultar-recomendaciones.use-case';
import { ANALITICA, type AnaliticaPort } from './application/ports/out/analitica.port';
import { ConsultarIndicadoresService } from './application/use-cases/consultar-indicadores.service';
import { ConsultarRecomendacionesService } from './application/use-cases/consultar-recomendaciones.service';
import { IndicadoresController } from './infrastructure/in/http/indicadores.controller';
import { RecomendacionesController } from './infrastructure/in/http/recomendaciones.controller';
import { AnaliticaHttpAdapter } from './infrastructure/out/http/analitica-http.adapter';

/**
 * Analítica para los clientes (RF-10 y RF-19). El cálculo vive en el servicio FastAPI; este
 * módulo valida la fila con el catálogo de turnos, guarda en Redis y aplica el ámbito.
 */
@Module({
  imports: [TurnosModule, AuditoriaModule],
  controllers: [RecomendacionesController, IndicadoresController],
  providers: [
    { provide: ANALITICA, useClass: AnaliticaHttpAdapter },
    {
      provide: CONSULTAR_RECOMENDACIONES,
      useFactory: (catalogo: CatalogoPort, analitica: AnaliticaPort, cache: CachePort, reloj: RelojPort) =>
        new ConsultarRecomendacionesService(catalogo, analitica, cache, reloj),
      inject: [CATALOGO, ANALITICA, CACHE, RELOJ],
    },
    {
      provide: CONSULTAR_INDICADORES,
      useFactory: (catalogo: CatalogoPort, analitica: AnaliticaPort, cache: CachePort, reloj: RelojPort, auditoria: AuditLogPort) =>
        new ConsultarIndicadoresService(catalogo, analitica, cache, reloj, auditoria),
      inject: [CATALOGO, ANALITICA, CACHE, RELOJ, AUDIT_LOG],
    },
  ],
})
export class AnaliticaModule {}
