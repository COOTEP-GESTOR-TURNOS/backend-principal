export const ESTIMADOR = Symbol('ESTIMADOR');

export interface ParametrosEspera {
  /** t̄: minutos promedio de atención del servicio en la franja. */
  tAtencionMin: number;
  /** p: proporción histórica de turnos preferenciales en la franja. */
  pPreferencial: number;
}

/** Puerto de salida hacia el servicio de analítica (FastAPI). */
export interface EstimadorPort {
  /** Devuelve null si no hay historial suficiente para esa franja. */
  parametros(agenciaId: string, servicioId: string, franja: string): Promise<ParametrosEspera | null>;
}
