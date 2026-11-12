import type { Turno } from '../../domain/turno';
import type { EventStorePort, GeneradorIdsPort } from '../ports/out/otros.ports';

/**
 * Asigna un eventoId a cada evento pendiente y los publica.
 * El id se asigna una sola vez: si el adaptador reintenta, MongoDB descarta el duplicado.
 */
export async function publicarEventos(turno: Turno, eventos: EventStorePort, ids: GeneradorIdsPort): Promise<void> {
  const pendientes = turno.extraerEventos().map((evento) => ({ ...evento, eventoId: ids.nuevo() }));
  if (pendientes.length > 0) {
    await eventos.publicar(pendientes);
  }
}
