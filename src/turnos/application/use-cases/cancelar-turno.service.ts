import { NoEncontradoError } from '../../../compartido/domain/errores';
import type { CancelarTurnoComando, CancelarTurnoUseCase } from '../ports/in/cancelar-turno.use-case';
import type { MotorFilasPort } from '../ports/out/motor-filas.port';
import type { EventStorePort, GeneradorIdsPort, NotificadorPort, RelojPort } from '../ports/out/otros.ports';
import type { TurnoRepository } from '../ports/out/turno.repository';
import { resumir, ResumenTurno } from '../resumen-turno';
import { publicarEventos } from './publicar-eventos';

/** CU-03 Cancelar el turno propio. Idempotente: cancelar dos veces devuelve el mismo resultado. */
export class CancelarTurnoService implements CancelarTurnoUseCase {
  constructor(
    private readonly turnos: TurnoRepository,
    private readonly motor: MotorFilasPort,
    private readonly eventos: EventStorePort,
    private readonly notificador: NotificadorPort,
    private readonly ids: GeneradorIdsPort,
    private readonly reloj: RelojPort,
  ) {}

  async ejecutar({ turnoId, solicitante }: CancelarTurnoComando): Promise<ResumenTurno> {
    const turno = await this.turnos.obtener(turnoId);
    // RN-14: un turno ajeno se trata como inexistente para no revelar datos de otro asociado.
    if (!turno || !turno.perteneceA(solicitante.id)) {
      throw new NoEncontradoError('TURNO_NO_EXISTE', 'No existe ese turno');
    }

    const cambio = turno.cancelar('CANCELADO_POR_ASOCIADO', solicitante.id, this.reloj.ahora());
    if (cambio) {
      await this.motor.retirar(turno.filaId, turno.id);
      await this.turnos.actualizar(turno);
      await publicarEventos(turno, this.eventos, this.ids);
      await this.notificador.filaActualizada(turno.filaId);
    }
    const resumen = resumir(turno, null);
    await this.notificador.turnoActualizado(turno.asociadoId, resumen);
    return resumen;
  }
}
