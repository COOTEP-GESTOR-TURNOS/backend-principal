import type { Canal } from '../../../domain/tipos';
import type { ResumenTurno } from '../../resumen-turno';

export const SOLICITAR_TURNO = Symbol('SOLICITAR_TURNO');

export interface SolicitarTurnoComando {
  asociadoId: string;
  agenciaId: string;
  servicioId: string;
  /** Autodeclaración de gestante o discapacidad (RN-06). */
  solicitaPreferencial: boolean;
  canal: Canal;
  /** Cabecera Idempotency-Key: la misma clave devuelve el mismo turno. */
  idempotencyKey: string;
}

/** Puerto de entrada: CU-02 Solicitar turno. */
export interface SolicitarTurnoUseCase {
  ejecutar(comando: SolicitarTurnoComando): Promise<ResumenTurno>;
}
