import type { Turno } from '../../../domain/turno';

export const TURNO_REPOSITORY = Symbol('TURNO_REPOSITORY');

/** Puerto de salida hacia la fuente de verdad del turno (PostgreSQL). */
export interface TurnoRepository {
  /** Lanza ConflictoError TURNO_ACTIVO (RN-01) o SOLICITUD_DUPLICADA (idempotencia). */
  guardarNuevo(turno: Turno): Promise<void>;
  /** Bloqueo optimista: lanza ConflictoError TURNO_MODIFICADO si otro proceso lo cambió. */
  actualizar(turno: Turno): Promise<void>;
  obtener(id: string): Promise<Turno | null>;
  buscarPorIdempotencia(asociadoId: string, clave: string): Promise<Turno | null>;
  buscarActivoDeAsociado(asociadoId: string): Promise<Turno | null>;
}
