export const REVISAR_VENCIMIENTOS = Symbol('REVISAR_VENCIMIENTOS');

export interface ResultadoRevision {
  /** false si otra instancia tenía el cerrojo y este ciclo no hizo nada. */
  ejecutada: boolean;
  revisados: number;
  /** Turnos En espera que pasaron a Próximo porque la fila avanzó (RN-10). */
  proximos: number;
  sinConfirmar: number;
  noSePresento: number;
  /** Atenciones olvidadas que el sistema cerró (CIERRE_AUTOMATICO). */
  atencionesCerradas: number;
  /** El asociado o el funcionario cambiaron el turno al mismo tiempo; su acción gana. */
  conflictos: number;
  errores: number;
}

/** Puerto de entrada: un ciclo de la tarea programada de vencimientos (RN-10, RN-11). */
export interface RevisarVencimientosUseCase {
  ejecutar(): Promise<ResultadoRevision>;
}
