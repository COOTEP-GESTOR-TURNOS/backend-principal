import { NoEncontradoError } from '../../../compartido/domain/errores';
import type { CancelarTurnoComando, CancelarTurnoUseCase } from '../ports/in/cancelar-turno.use-case';
import type { MotorFilasPort } from '../ports/out/motor-filas.port';
import type { EventStorePort, GeneradorIdsPort, NotificadorPort, RelojPort } from '../ports/out/otros.ports';
import type { TurnoRepository } from '../ports/out/turno.repository';
import { cambiarTurno } from '../cambiar-turno';
import { resumir, ResumenTurno } from '../resumen-turno';
import { publicarEventos } from './publicar-eventos';

/**
 * CU-03 Cancelar el turno propio. Idempotente: cancelar dos veces devuelve el mismo resultado.
 * Primero guarda y solo después retira: si la base no guarda, el turno conserva su puesto.
 */
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
    const noExiste = () => new NoEncontradoError('TURNO_NO_EXISTE', 'No existe ese turno');
    const resultado = await cambiarTurno(this.turnos, turnoId, (turno) => {
      // RN-14: un turno ajeno se trata como inexistente para no revelar datos de otro asociado.
      if (!turno.perteneceA(solicitante.id)) throw noExiste();
      return turno.cancelar('CANCELADO_POR_ASOCIADO', solicitante.id, this.reloj.ahora());
    });
    if (!resultado) throw noExiste();

    const { turno, guardado } = resultado;
    // También al repetir la cancelación. Si el motor no responde, al llamar se salta el turno terminado.
    await this.motor.retirar(turno.filaId, turno.id).catch(() => undefined);
    if (guardado) {
      await publicarEventos(turno, this.eventos, this.ids);
      await this.notificador.filaActualizada(turno.filaId);
    }
    const resumen = resumir(turno, null);
    await this.notificador.turnoActualizado(turno.asociadoId, resumen);
    return resumen;
  }
}
