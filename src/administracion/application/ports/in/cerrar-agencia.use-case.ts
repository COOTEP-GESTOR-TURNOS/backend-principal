import type { Principal } from '../../../../compartido/domain/principal';

export const CERRAR_AGENCIA = Symbol('CERRAR_AGENCIA');

export interface ResultadoCierre {
  agenciaId: string;
  nombre: string;
  fecha: string;
  /** true si lo hizo la tarea programada a la hora de cierre. */
  automatico: boolean;
  /** Turnos pendientes (solicitados, en espera o próximos) que quedaron CANCELADO con motivo CIERRE_AGENCIA. */
  cancelados: number;
  /** Turnos que el motor sacó de las colas de Redis. */
  retiradosDelMotor: number;
  /** Lo que tardó el motor en vaciar todas las filas en paralelo. */
  duracionMotorMs: number;
  /** Turnos llamados o en atención: se atienden hasta terminar. */
  siguenEnAtencion: number;
}

/** Puerto de entrada (RN-13, CU-05): cierre de la jornada de una agencia. */
export interface CerrarAgenciaUseCase {
  /** actor null = cierre automático del sistema. */
  cerrarJornada(actor: Principal | null, agenciaId: string, ip?: string): Promise<ResultadoCierre>;
  /**
   * Cancela los pendientes rezagados de jornadas ya terminadas y cierra, una vez por día, las
   * agencias que pasaron su hora de cierre.
   */
  cierreAutomatico(): Promise<ResultadoCierre[]>;
  /** Deshace un cierre anticipado: la agencia vuelve a recibir turnos hoy si está en horario. */
  reabrirJornada(actor: Principal, agenciaId: string, ip?: string): Promise<{ agenciaId: string; fecha: string; reabierta: boolean }>;
  /** true si la jornada de hoy ya se cerró (a mano o a la hora de cierre). */
  jornadaCerrada(agenciaId: string): Promise<boolean>;
}
