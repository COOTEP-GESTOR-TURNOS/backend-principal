import type { Principal } from '../../../../compartido/domain/principal';
import type { ResumenTurno } from '../../resumen-turno';

export const CONSULTAR_VENTANILLA = Symbol('CONSULTAR_VENTANILLA');

/** Puerto de entrada: CU-04 el turno que el funcionario tiene llamado o en atención. */
export interface ConsultarVentanillaUseCase {
  ejecutar(funcionario: Principal): Promise<ResumenTurno | null>;
}
