import { Injectable } from '@nestjs/common';
import { leerConfig } from '../../../../compartido/infrastructure/config';
import { llamarServicio } from '../../../../compartido/infrastructure/http/cliente-servicio';
import type {
  AnaliticaPort,
  IndicadoresAnalitica,
  RecomendacionAnalitica,
} from '../../../application/ports/out/analitica.port';

/** Adaptador de salida hacia la analítica (FastAPI): token de servicio, X-Request-Id y 2 s de límite. */
@Injectable()
export class AnaliticaHttpAdapter implements AnaliticaPort {
  async recomendaciones(agenciaId: string, servicioId: string, fecha: string): Promise<RecomendacionAnalitica | null> {
    const { analiticaUrl, serviceToken } = leerConfig();
    const consulta = new URLSearchParams({ agenciaId, servicioId, fecha });
    const { datos } = await llamarServicio<RecomendacionAnalitica>(
      analiticaUrl,
      serviceToken,
      'GET',
      `/api/v1/recomendaciones?${consulta.toString()}`,
      { reintentable: true },
    );
    return datos;
  }

  async indicadores(agenciaId: string, desde: string, hasta: string): Promise<IndicadoresAnalitica | null> {
    const { analiticaUrl, serviceToken } = leerConfig();
    const consulta = new URLSearchParams({ agenciaId, desde, hasta });
    const { datos } = await llamarServicio<IndicadoresAnalitica>(
      analiticaUrl,
      serviceToken,
      'GET',
      `/api/v1/indicadores?${consulta.toString()}`,
      { reintentable: true },
    );
    return datos;
  }
}
