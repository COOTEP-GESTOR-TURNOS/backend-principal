import { Injectable } from '@nestjs/common';
import { ServicioNoDisponibleError } from '../../../../compartido/application/errores-aplicacion';
import { ConflictoError, NoEncontradoError } from '../../../../compartido/domain/errores';
import { leerConfig } from '../../../../compartido/infrastructure/config';
import { llamarServicio, type Respuesta } from '../../../../compartido/infrastructure/http/cliente-servicio';
import type {
  AnaliticaPort,
  IndicadoresAnalitica,
  RecomendacionAnalitica,
} from '../../../application/ports/out/analitica.port';
import type {
  ActividadAnalitica, AgenciaTableroMensual, CalendarioDemanda, DatosEventoAgencia, DemandaPort, EventoAgencia,
  FiltrosIndicadores, OpcionesCalendarioAgencia, RangoAnalitica, TableroMensual,
} from '../../../application/ports/out/demanda.port';

const TIEMPO_LIMITE_PRONOSTICO_MS = 5_000;
const rutaAgencia = (agenciaId: string) => `/api/v1/analitica/agencias/${encodeURIComponent(agenciaId)}`;

/** Adaptador de salida hacia la analítica (FastAPI): token de servicio, X-Request-Id y 2 s de límite. */
@Injectable()
export class AnaliticaHttpAdapter implements AnaliticaPort, DemandaPort {
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

  async indicadores(agenciaId: string, desde: string, hasta: string,
    { servicioId, colaboradorId }: FiltrosIndicadores = {}): Promise<IndicadoresAnalitica | null> {
    const { analiticaUrl, serviceToken } = leerConfig();
    const consulta = new URLSearchParams({ agenciaId, desde, hasta });
    if (servicioId) consulta.set('servicioId', servicioId);
    if (colaboradorId) consulta.set('colaboradorId', colaboradorId);
    const { datos } = await llamarServicio<IndicadoresAnalitica>(
      analiticaUrl,
      serviceToken,
      'GET',
      `/api/v1/indicadores?${consulta.toString()}`,
      { reintentable: true },
    );
    return datos;
  }

  async calendario(agenciaId: string, mes: string,
    { activa, servicioId, servicioActivo, ...ubicacion }: OpcionesCalendarioAgencia = {}): Promise<CalendarioDemanda> {
    const { analiticaUrl, serviceToken } = leerConfig();
    const consulta = new URLSearchParams({ mes, ...ubicacion });
    if (activa === false) consulta.set('activa', 'false');
    if (servicioId) consulta.set('servicioId', servicioId);
    if (servicioActivo === false) consulta.set('servicioActivo', 'false');
    const { datos } = await llamarServicio<CalendarioDemanda>(
      analiticaUrl,
      serviceToken,
      'GET',
      `${rutaAgencia(agenciaId)}/demanda?${consulta.toString()}`,
      { reintentable: true, tiempoLimiteMs: TIEMPO_LIMITE_PRONOSTICO_MS },
    );
    if (!datos) throw new ServicioNoDisponibleError('No se pudo obtener el calendario de demanda');
    return datos;
  }

  async tablero(mes: string, agencias: AgenciaTableroMensual[], agenciaId: string | null,
    filtros: FiltrosIndicadores = {}): Promise<TableroMensual> {
    const { analiticaUrl, serviceToken } = leerConfig();
    const { datos } = await llamarServicio<TableroMensual>(analiticaUrl, serviceToken, 'POST', '/api/v1/analitica/tablero', {
      reintentable: true, tiempoLimiteMs: TIEMPO_LIMITE_PRONOSTICO_MS, cuerpo: { mes, agencias, agenciaId, ...filtros },
    });
    if (!datos) throw new ServicioNoDisponibleError('No se pudo obtener el tablero mensual');
    return datos;
  }

  async opcionesHistoricas(rango: RangoAnalitica, agenciaIds: string[], servicioId?: string): Promise<ActividadAnalitica[]> {
    const { analiticaUrl, serviceToken } = leerConfig();
    const { datos } = await llamarServicio<{ opciones: ActividadAnalitica[] }>(analiticaUrl, serviceToken, 'POST',
      '/api/v1/analitica/filtros', {
        reintentable: true, tiempoLimiteMs: TIEMPO_LIMITE_PRONOSTICO_MS, cuerpo: { ...rango, agenciaIds, servicioId },
      });
    if (!datos) throw new ServicioNoDisponibleError('No se pudieron consultar los filtros históricos');
    return datos.opciones;
  }

  async crearEvento(agenciaId: string, cuerpo: DatosEventoAgencia): Promise<EventoAgencia> {
    const { analiticaUrl, serviceToken } = leerConfig();
    const respuesta = await llamarServicio<EventoAgencia>(analiticaUrl, serviceToken, 'POST', `${rutaAgencia(agenciaId)}/eventos`,
      { cuerpo, reintentable: false, estadosSinDatos: [409] });
    return this.eventoGuardado(respuesta);
  }

  async editarEvento(agenciaId: string, eventoId: string, cuerpo: Partial<DatosEventoAgencia>): Promise<EventoAgencia> {
    const { analiticaUrl, serviceToken } = leerConfig();
    const respuesta = await llamarServicio<EventoAgencia>(analiticaUrl, serviceToken, 'PATCH',
      `${rutaAgencia(agenciaId)}/eventos/${encodeURIComponent(eventoId)}`,
      { cuerpo, reintentable: false, estadosSinDatos: [409] });
    return this.eventoGuardado(respuesta);
  }

  async eliminarEvento(agenciaId: string, eventoId: string): Promise<void> {
    const { analiticaUrl, serviceToken } = leerConfig();
    const { status } = await llamarServicio<never>(analiticaUrl, serviceToken, 'DELETE',
      `${rutaAgencia(agenciaId)}/eventos/${encodeURIComponent(eventoId)}`, { reintentable: false });
    if (status === 404) throw new NoEncontradoError('EVENTO_AGENCIA_NO_ENCONTRADO', 'El evento no existe en esta agencia');
  }

  private eventoGuardado({ status, datos }: Respuesta<EventoAgencia>): EventoAgencia {
    if (status === 409) throw new ConflictoError('EVENTO_AGENCIA_DUPLICADO', 'Ya existe un evento de ese tipo en la fecha indicada');
    if (status === 404) throw new NoEncontradoError('EVENTO_AGENCIA_NO_ENCONTRADO', 'El evento no existe en esta agencia');
    if (!datos) throw new ServicioNoDisponibleError('No se pudo guardar el evento de la agencia');
    return datos;
  }
}
