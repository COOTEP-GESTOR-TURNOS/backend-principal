import type { EstadoTurno } from '../../../domain/estado-turno';
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
  /** Turnos de un día (hora local) en esos estados; con agencia, solo los de esa agencia (cierre). */
  buscarDelDiaPorEstado(fecha: string, estados: EstadoTurno[], agenciaId?: string): Promise<Turno[]>;
  /** Turnos de ese día o de días anteriores en esos estados: así ninguno queda fuera de la revisión. */
  buscarHastaDiaPorEstado(fecha: string, estados: EstadoTurno[]): Promise<Turno[]>;
  /** Llamados o en atención que tiene ese funcionario, del más antiguo al más reciente. */
  buscarEnVentanilla(funcionarioId: string): Promise<Turno[]>;
}
