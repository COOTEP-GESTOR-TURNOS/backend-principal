import type { ResumenTurno } from '../../resumen-turno';

export const CONSULTAR_MI_TURNO = Symbol('CONSULTAR_MI_TURNO');

export interface MiTurno extends ResumenTurno {
  /** Minutos estimados; null si la analítica no respondió o no hay historial. */
  esperaEstimadaMin: number | null;
}

/** Puerto de entrada: CU-03 Seguir el turno (posición y espera). */
export interface ConsultarMiTurnoUseCase {
  ejecutar(asociadoId: string): Promise<MiTurno | null>;
}
