import { NoEncontradoError, PermisoDenegadoError } from '../../../compartido/domain/errores';
import { Principal, puedeOperarFila } from '../../../compartido/domain/principal';
import type {
  AtenderTurnoComando,
  AtenderTurnoUseCase,
  ConfirmarPresenciaUseCase,
} from '../ports/in/atender-turno.use-case';
import type { MotorFilasPort } from '../ports/out/motor-filas.port';
import type { EventStorePort, GeneradorIdsPort, NotificadorPort, RelojPort } from '../ports/out/otros.ports';
import type { TurnoRepository } from '../ports/out/turno.repository';
import { resumir, ResumenTurno } from '../resumen-turno';
import { publicarEventos } from './publicar-eventos';

/** CU-04: iniciar, finalizar, marcar ausente o verificar la atención preferencial. */
export class AtenderTurnoService implements AtenderTurnoUseCase {
  constructor(
    private readonly turnos: TurnoRepository,
    private readonly motor: MotorFilasPort,
    private readonly eventos: EventStorePort,
    private readonly notificador: NotificadorPort,
    private readonly ids: GeneradorIdsPort,
    private readonly reloj: RelojPort,
  ) {}

  async ejecutar(comando: AtenderTurnoComando): Promise<ResumenTurno> {
    const turno = await this.turnos.obtener(comando.turnoId);
    if (!turno) throw new NoEncontradoError('TURNO_NO_EXISTE', 'No existe ese turno');
    // RN-14: solo los funcionarios de esa agencia y servicio atienden el turno.
    if (!puedeOperarFila(comando.funcionario, turno.agenciaId, turno.servicioId)) {
      throw new PermisoDenegadoError('FILA_FUERA_DE_AMBITO', 'El turno es de otra agencia o servicio');
    }

    const ahora = this.reloj.ahora();
    const funcionarioId = comando.funcionario.id;
    switch (comando.accion) {
      case 'INICIAR':
        turno.iniciarAtencion(funcionarioId, ahora);
        break;
      case 'FINALIZAR':
        turno.finalizar(funcionarioId, ahora);
        break;
      case 'AUSENTE':
        turno.marcarAusente('NO_SE_PRESENTO', funcionarioId, ahora);
        break;
      case 'VERIFICAR_PREFERENCIAL':
        turno.verificarPreferencial(funcionarioId, comando.cumplePreferencial ?? false, ahora);
        if (comando.cumplePreferencial === false) {
          // RN-07: vuelve a la fila general con su número original.
          await this.motor.encolar(turno.filaId, turno.id, 'GENERAL', 1);
        }
        break;
    }

    await this.turnos.actualizar(turno);
    await publicarEventos(turno, this.eventos, this.ids);
    const resumen = resumir(turno, null);
    await this.notificador.turnoActualizado(turno.asociadoId, resumen);
    await this.notificador.filaActualizada(turno.filaId);
    return resumen;
  }
}

/** CU-03: el asociado confirma su presencia cuando el turno está próximo (RN-10). */
export class ConfirmarPresenciaService implements ConfirmarPresenciaUseCase {
  constructor(
    private readonly turnos: TurnoRepository,
    private readonly eventos: EventStorePort,
    private readonly notificador: NotificadorPort,
    private readonly ids: GeneradorIdsPort,
    private readonly reloj: RelojPort,
  ) {}

  async ejecutar(turnoId: string, asociado: Principal): Promise<ResumenTurno> {
    const turno = await this.turnos.obtener(turnoId);
    if (!turno || !turno.perteneceA(asociado.id)) {
      throw new NoEncontradoError('TURNO_NO_EXISTE', 'No existe ese turno');
    }
    if (turno.confirmarPresencia(this.reloj.ahora())) {
      await this.turnos.actualizar(turno);
      await publicarEventos(turno, this.eventos, this.ids);
    }
    const resumen = resumir(turno, null);
    await this.notificador.turnoActualizado(turno.asociadoId, resumen);
    return resumen;
  }
}
