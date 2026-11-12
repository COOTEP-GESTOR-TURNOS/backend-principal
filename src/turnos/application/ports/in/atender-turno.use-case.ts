import type { Principal } from '../../../../compartido/domain/principal';
import type { ResumenTurno } from '../../resumen-turno';

export const ATENDER_TURNO = Symbol('ATENDER_TURNO');
export const CONFIRMAR_PRESENCIA = Symbol('CONFIRMAR_PRESENCIA');

export type AccionAtencion = 'INICIAR' | 'FINALIZAR' | 'AUSENTE' | 'VERIFICAR_PREFERENCIAL';

export interface AtenderTurnoComando {
  turnoId: string;
  accion: AccionAtencion;
  funcionario: Principal;
  /** Solo para VERIFICAR_PREFERENCIAL: si la condición se comprobó en la ventanilla. */
  cumplePreferencial?: boolean;
}

/** Puerto de entrada: CU-04 iniciar, finalizar, marcar ausente o verificar la atención preferencial. */
export interface AtenderTurnoUseCase {
  ejecutar(comando: AtenderTurnoComando): Promise<ResumenTurno>;
}

/** Puerto de entrada: CU-03 el asociado confirma que viene (RN-10). */
export interface ConfirmarPresenciaUseCase {
  ejecutar(turnoId: string, asociado: Principal): Promise<ResumenTurno>;
}
