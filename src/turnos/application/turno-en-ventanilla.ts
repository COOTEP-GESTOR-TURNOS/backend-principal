import { type Principal, puedeOperarFila } from '../../compartido/domain/principal';
import type { Turno } from '../domain/turno';
import type { TurnoRepository } from './ports/out/turno.repository';

/**
 * El turno que el funcionario debe terminar. Solo cuenta si todavía puede operar esa fila: si lo
 * pasaron a otra agencia no lo podría finalizar, y no debe quedarse sin poder llamar.
 */
export async function turnoEnVentanilla(turnos: TurnoRepository, funcionario: Principal): Promise<Turno | null> {
  const abiertos = await turnos.buscarEnVentanilla(funcionario.id);
  return abiertos.find((t) => puedeOperarFila(funcionario, t.agenciaId, t.servicioId)) ?? null;
}
