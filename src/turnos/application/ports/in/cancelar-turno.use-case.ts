import type { Principal } from '../../../../compartido/domain/principal';
import type { ResumenTurno } from '../../resumen-turno';

export const CANCELAR_TURNO = Symbol('CANCELAR_TURNO');

export interface CancelarTurnoComando {
  turnoId: string;
  solicitante: Principal;
}

/** Puerto de entrada: CU-03 Cancelar el turno propio. */
export interface CancelarTurnoUseCase {
  ejecutar(comando: CancelarTurnoComando): Promise<ResumenTurno>;
}
