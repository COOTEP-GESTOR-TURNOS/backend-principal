import type { TipoAtencion } from '../../../domain/tipos';

export const MOTOR_FILAS = Symbol('MOTOR_FILAS');

export interface ResultadoEncolar {
  numero: number;
  personasDelante: number;
}

export interface TurnoEntregado {
  turnoId: string;
  numero: number;
  tipoAtencion: TipoAtencion;
}

/**
 * Puerto de salida hacia el motor de filas (servicio Spring Boot).
 * El dominio define qué necesita; el adaptador HTTP decide cómo se pide.
 */
export interface MotorFilasPort {
  /** Idempotente por turnoId: un reintento devuelve el mismo número. */
  encolar(filaId: string, turnoId: string, tipo: TipoAtencion, maxPreferencialesSeguidos: number): Promise<ResultadoEncolar>;
  /** Atómico (RN-08, RN-09): dos funcionarios nunca reciben el mismo turno. */
  siguiente(filaId: string, maxPreferencialesSeguidos: number): Promise<TurnoEntregado | null>;
  personasDelante(filaId: string, turnoId: string, maxPreferencialesSeguidos: number): Promise<number | null>;
  /** Idempotente. */
  retirar(filaId: string, turnoId: string): Promise<void>;
}
