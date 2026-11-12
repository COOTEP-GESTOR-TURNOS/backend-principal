export interface DatosEstimacion {
  /** Personas delante según el motor de filas. */
  personasDelante: number;
  /** t̄: minutos promedio de atención del servicio en la franja (analítica). */
  tAtencionMin: number;
  /** v: ventanillas activas del servicio. */
  ventanillas: number;
  /** p: proporción histórica de turnos preferenciales en la franja (analítica). */
  pPreferencial: number;
  /** K de la regla RN-08. */
  maxPreferencialesSeguidos: number;
  /** Un turno preferencial no espera por los preferenciales que lleguen después (p = 0). */
  esPreferencial: boolean;
}

/**
 * Espera estimada en minutos: n · t̄ / (v · (1 − p)).
 * Por la regla RN-08, p nunca supera K / (K + 1). Devuelve null si los datos no alcanzan.
 */
export function estimarEsperaMin(d: DatosEstimacion): number | null {
  if (d.ventanillas <= 0 || d.tAtencionMin <= 0 || d.personasDelante < 0) return null;
  const k = Math.max(1, d.maxPreferencialesSeguidos);
  const p = d.esPreferencial ? 0 : Math.min(Math.max(d.pPreferencial, 0), k / (k + 1));
  const minutos = (d.personasDelante * d.tAtencionMin) / (d.ventanillas * (1 - p));
  return Math.round(minutos * 10) / 10;
}
