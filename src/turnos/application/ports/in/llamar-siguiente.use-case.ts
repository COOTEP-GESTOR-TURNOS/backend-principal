import type { Principal } from '../../../../compartido/domain/principal';
import type { ResumenTurno } from '../../resumen-turno';

export const LLAMAR_SIGUIENTE = Symbol('LLAMAR_SIGUIENTE');

export interface LlamarSiguienteComando {
  agenciaId: string;
  servicioId: string;
  funcionario: Principal;
}

/** Puerto de entrada: CU-04 Llamar al siguiente. Devuelve null si la fila está vacía. */
export interface LlamarSiguienteUseCase {
  ejecutar(comando: LlamarSiguienteComando): Promise<ResumenTurno | null>;
}
