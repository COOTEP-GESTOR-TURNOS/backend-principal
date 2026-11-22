import { ConflictoError, ErrorDeDominio, NoEncontradoError, PermisoDenegadoError } from '../../../compartido/domain/errores';
import { puedeOperarFila } from '../../../compartido/domain/principal';
import type { LlamarSiguienteComando, LlamarSiguienteUseCase } from '../ports/in/llamar-siguiente.use-case';
import type { MotorFilasPort, TurnoEntregado } from '../ports/out/motor-filas.port';
import type {
  CatalogoPort,
  CerrojoPort,
  EventStorePort,
  GeneradorIdsPort,
  NotificadorPort,
  RelojPort,
} from '../ports/out/otros.ports';
import type { TurnoRepository } from '../ports/out/turno.repository';
import { resumir, ResumenTurno } from '../resumen-turno';
import { EstadoTurno } from '../../domain/estado-turno';
import type { Fila } from '../../domain/fila';
import type { Turno } from '../../domain/turno';
import { cambiarTurno, esCambioSimultaneo } from '../cambiar-turno';
import { turnoEnVentanilla } from '../turno-en-ventanilla';
import { publicarEventos } from './publicar-eventos';

const TTL_LLAMADO_SEG = 15;

/**
 * CU-04 Llamar al siguiente. La regla K se define aquí y el motor la ejecuta de forma atómica.
 * Cada funcionario tiene un turno en ventanilla a la vez: con un cerrojo por funcionario, ni una
 * doble pulsación ni dos pestañas le dejan un turno abierto que nadie ve.
 */
export class LlamarSiguienteService implements LlamarSiguienteUseCase {
  constructor(
    private readonly turnos: TurnoRepository,
    private readonly catalogo: CatalogoPort,
    private readonly motor: MotorFilasPort,
    private readonly eventos: EventStorePort,
    private readonly notificador: NotificadorPort,
    private readonly ids: GeneradorIdsPort,
    private readonly reloj: RelojPort,
    private readonly cerrojo: CerrojoPort,
  ) {}

  async ejecutar({ agenciaId, servicioId, funcionario }: LlamarSiguienteComando): Promise<ResumenTurno | null> {
    if (!puedeOperarFila(funcionario, agenciaId, servicioId)) {
      throw new PermisoDenegadoError('FILA_FUERA_DE_AMBITO', 'No puedes operar la fila de otra agencia o servicio');
    }
    const fila = await this.catalogo.obtenerFila(agenciaId, servicioId);
    if (!fila) throw new NoEncontradoError('FILA_NO_EXISTE', 'La agencia no ofrece ese servicio');

    const candado = `ventanilla:${funcionario.id}`;
    if (!(await this.cerrojo.tomar(candado, TTL_LLAMADO_SEG))) {
      throw new ConflictoError('LLAMADO_EN_CURSO', 'Ya se está llamando un turno con tu usuario; espera un momento');
    }
    let turno: Turno;
    try {
      const abierto = await turnoEnVentanilla(this.turnos, funcionario);
      if (abierto) {
        throw new ConflictoError(
          'TURNO_EN_VENTANILLA',
          `Tienes el turno ${abierto.codigo ?? ''} en ventanilla. Termínalo antes de llamar otro.`,
        );
      }
      const llamado = await this.llamarPrimeroPendiente(fila, funcionario.id);
      if (!llamado) return null;
      turno = llamado;
    } finally {
      await this.cerrojo.soltar(candado);
    }
    await publicarEventos(turno, this.eventos, this.ids);

    const resumen = resumir(turno, 0);
    await this.notificador.turnoActualizado(turno.asociadoId, resumen);
    await this.notificador.filaActualizada(fila.id);
    return resumen;
  }

  /** Lo que el motor entrega y ya terminó se salta; null si la fila quedó vacía. */
  private async llamarPrimeroPendiente(fila: Fila, funcionarioId: string): Promise<Turno | null> {
    const k = fila.parametros.maxPreferencialesSeguidos;
    for (;;) {
      const entregado = await this.motor.siguiente(fila.id, k);
      if (!entregado) return null;
      try {
        const llamado = await this.marcarLlamado(fila, entregado, funcionarioId);
        if (llamado) return llamado;
      } catch (error) {
        // El motor ya lo sacó: ante un fallo pasajero vuelve con su número. Un error de dominio se
        // repetiría en cada llamado y, devuelto a la cabeza, bloquearía la fila.
        if (!(error instanceof ErrorDeDominio) || esCambioSimultaneo(error)) {
          await this.motor.encolar(fila.id, entregado.turnoId, entregado.tipoAtencion, k).catch(() => undefined);
        }
        throw error;
      }
    }
  }

  private async marcarLlamado(fila: Fila, entregado: TurnoEntregado, funcionarioId: string): Promise<Turno | null> {
    const resultado = await cambiarTurno(this.turnos, entregado.turnoId, (turno) => {
      if (!turno.estaPendiente()) return false;
      const ahora = this.reloj.ahora();
      if (turno.estado === EstadoTurno.SOLICITADO) {
        // Lo llamaron antes de que la solicitud guardara su número: se completa con el que dio el motor.
        turno.asignarNumero(entregado.numero, fila.codigoPara(entregado.numero));
        turno.ponerEnEspera(ahora);
      }
      turno.llamar(funcionarioId, ahora);
      return true;
    });
    if (!resultado) {
      throw new ConflictoError('TURNO_DESCONOCIDO', 'El motor entregó un turno que no está en PostgreSQL');
    }
    return resultado.guardado ? resultado.turno : null;
  }
}
