export const CONSULTAR_RECOMENDACIONES = Symbol('CONSULTAR_RECOMENDACIONES');

export interface FranjaRecomendada {
  desde: string; // HH:MM
  hasta: string; // HH:MM, 30 minutos después
  esperaMedianaMin: number;
  /** Turnos del historial que respaldan la cifra. */
  turnos: number;
}

export interface RecomendacionHorario {
  agenciaId: string;
  servicioId: string;
  fecha: string;
  tipoDia: string | null;
  horario: { apertura: string; cierre: string };
  /** false si la analítica no respondió: el asociado igual puede pedir turno. */
  disponible: boolean;
  franjas: FranjaRecomendada[];
}

/** Puerto de entrada (RF-10): ¿a qué hora conviene ir? */
export interface ConsultarRecomendacionesUseCase {
  ejecutar(cmd: { agenciaId: string; servicioId: string; fecha?: string }): Promise<RecomendacionHorario>;
}
