import { ConflictoError } from '../../compartido/domain/errores';
import type { Turno } from '../domain/turno';
import type { TurnoRepository } from './ports/out/turno.repository';

const INTENTOS = 5;

/** Otro proceso guardó el turno primero (bloqueo optimista por version). */
export function esCambioSimultaneo(error: unknown): boolean {
  return error instanceof ConflictoError && error.codigo === 'TURNO_MODIFICADO';
}

/**
 * Lee el turno, le aplica `cambio` y lo guarda. Si otro lo cambió en ese instante, lo relee y decide
 * otra vez sobre el estado nuevo. `cambio` devuelve false si no hay nada que guardar; null = no existe.
 */
export async function cambiarTurno(
  turnos: TurnoRepository,
  turnoId: string,
  cambio: (turno: Turno) => boolean,
): Promise<{ turno: Turno; guardado: boolean } | null> {
  for (let intento = 1; ; intento++) {
    const turno = await turnos.obtener(turnoId);
    if (!turno) return null;
    if (!cambio(turno)) return { turno, guardado: false };
    try {
      await turnos.actualizar(turno);
      return { turno, guardado: true };
    } catch (error) {
      if (!esCambioSimultaneo(error) || intento === INTENTOS) throw error;
    }
  }
}
