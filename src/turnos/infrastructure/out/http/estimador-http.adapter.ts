import { Injectable } from '@nestjs/common';
import { leerConfig } from '../../../../compartido/infrastructure/config';
import type { EstimadorPort, ParametrosEspera } from '../../../application/ports/out/estimador.port';
import { llamarServicio } from './cliente-servicio';

/** Adaptador de salida hacia la analítica (FastAPI), contrato en /openapi.json. */
@Injectable()
export class EstimadorHttpAdapter implements EstimadorPort {
  async parametros(agenciaId: string, servicioId: string, franja: string): Promise<ParametrosEspera | null> {
    const { analiticaUrl, serviceToken } = leerConfig();
    const consulta = new URLSearchParams({ agenciaId, servicioId, franja });
    const { datos } = await llamarServicio<ParametrosEspera>(
      analiticaUrl,
      serviceToken,
      'GET',
      `/api/v1/estimaciones/parametros?${consulta.toString()}`,
      { reintentable: true },
    );
    return datos;
  }
}
