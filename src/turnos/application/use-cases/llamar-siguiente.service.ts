import { ConflictoError, NoEncontradoError, PermisoDenegadoError } from '../../../compartido/domain/errores';
import { puedeOperarFila } from '../../../compartido/domain/principal';
import type { LlamarSiguienteComando, LlamarSiguienteUseCase } from '../ports/in/llamar-siguiente.use-case';
import type { MotorFilasPort } from '../ports/out/motor-filas.port';
import type {
  CatalogoPort,
  EventStorePort,
  GeneradorIdsPort,
  NotificadorPort,
  RelojPort,
} from '../ports/out/otros.ports';
import type { TurnoRepository } from '../ports/out/turno.repository';
import { resumir, ResumenTurno } from '../resumen-turno';
import { publicarEventos } from './publicar-eventos';

/** CU-04 Llamar al siguiente. La regla K se define aquí y el motor la ejecuta de forma atómica. */
export class LlamarSiguienteService implements LlamarSiguienteUseCase {
  constructor(
    private readonly turnos: TurnoRepository,
    private readonly catalogo: CatalogoPort,
    private readonly motor: MotorFilasPort,
    private readonly eventos: EventStorePort,
    private readonly notificador: NotificadorPort,
    private readonly ids: GeneradorIdsPort,
    private readonly reloj: RelojPort,
  ) {}

  async ejecutar({ agenciaId, servicioId, funcionario }: LlamarSiguienteComando): Promise<ResumenTurno | null> {
    if (!puedeOperarFila(funcionario, agenciaId, servicioId)) {
      throw new PermisoDenegadoError('FILA_FUERA_DE_AMBITO', 'No puedes operar la fila de otra agencia o servicio');
    }
    const fila = await this.catalogo.obtenerFila(agenciaId, servicioId);
    if (!fila) throw new NoEncontradoError('FILA_NO_EXISTE', 'La agencia no ofrece ese servicio');

    const entregado = await this.motor.siguiente(fila.id, fila.parametros.maxPreferencialesSeguidos);
    if (!entregado) return null;

    const turno = await this.turnos.obtener(entregado.turnoId);
    if (!turno) {
      throw new ConflictoError('TURNO_DESCONOCIDO', 'El motor entregó un turno que no está en PostgreSQL');
    }
    turno.llamar(funcionario.id, this.reloj.ahora());
    await this.turnos.actualizar(turno);
    await publicarEventos(turno, this.eventos, this.ids);

    const resumen = resumir(turno, 0);
    await this.notificador.turnoActualizado(turno.asociadoId, resumen);
    await this.notificador.filaActualizada(fila.id);
    return resumen;
  }
}
