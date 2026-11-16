import { Module } from '@nestjs/common';
import { CACHE, type CachePort } from '../compartido/application/ports/cache.port';
import { CATALOGO, type CatalogoPort, RELOJ, type RelojPort } from '../turnos/application/ports/out/otros.ports';
import { TurnosModule } from '../turnos/turnos.module';
import { CONSULTAR_RECOMENDACIONES } from './application/ports/in/consultar-recomendaciones.use-case';
import { ANALITICA, type AnaliticaPort } from './application/ports/out/analitica.port';
import { ConsultarRecomendacionesService } from './application/use-cases/consultar-recomendaciones.service';
import { RecomendacionesController } from './infrastructure/in/http/recomendaciones.controller';
import { AnaliticaHttpAdapter } from './infrastructure/out/http/analitica-http.adapter';

/**
 * Analítica para los clientes (RF-10 y, en S1-03, RF-19). El cálculo vive en el servicio FastAPI;
 * este módulo valida la fila con el catálogo de turnos, guarda en Redis y aplica el ámbito.
 */
@Module({
  imports: [TurnosModule],
  controllers: [RecomendacionesController],
  providers: [
    { provide: ANALITICA, useClass: AnaliticaHttpAdapter },
    {
      provide: CONSULTAR_RECOMENDACIONES,
      useFactory: (catalogo: CatalogoPort, analitica: AnaliticaPort, cache: CachePort, reloj: RelojPort) =>
        new ConsultarRecomendacionesService(catalogo, analitica, cache, reloj),
      inject: [CATALOGO, ANALITICA, CACHE, RELOJ],
    },
  ],
})
export class AnaliticaModule {}
