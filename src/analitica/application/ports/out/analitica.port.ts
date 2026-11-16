export const ANALITICA = Symbol('ANALITICA');

/** Franja de 30 minutos con su espera mediana histórica (ClickHouse, servicio de analítica). */
export interface FranjaHistorica {
  franja: string; // HH:MM
  esperaMedianaMin: number;
  turnos: number;
}

export interface RecomendacionAnalitica {
  fecha: string; // AAAA-MM-DD
  tipoDia: string;
  franjas: FranjaHistorica[];
}

/** Indicadores de una agencia en un rango de fechas (hechos_turno de ClickHouse). */
export interface IndicadoresAnalitica {
  atendidos: number;
  cancelados: number;
  ausentes: number;
  esperaPromedioMin: number;
  atencionPromedioMin: number;
  /** Proporción de turnos preferenciales sobre todos los turnos del rango (0 a 1). */
  proporcionPreferencial: number;
}

/** Puerto de salida hacia el servicio de analítica (FastAPI). */
export interface AnaliticaPort {
  /** Las mejores franjas para ese día de la semana y tipo de día; null si no hay datos. */
  recomendaciones(agenciaId: string, servicioId: string, fecha: string): Promise<RecomendacionAnalitica | null>;
  indicadores(agenciaId: string, desde: string, hasta: string): Promise<IndicadoresAnalitica | null>;
}
