import { ServicioNoDisponibleError } from '../../../compartido/application/errores-aplicacion';
import { ConflictoError, NoEncontradoError, ReglaNegocioError } from '../../../compartido/domain/errores';
import { fechaLocal } from '../../../compartido/domain/tiempo';
import { PoliticaPreferencial } from '../../domain/politica-preferencial';
import { Turno } from '../../domain/turno';
import type { SolicitarTurnoComando, SolicitarTurnoUseCase } from '../ports/in/solicitar-turno.use-case';
import type { MotorFilasPort, ResultadoEncolar } from '../ports/out/motor-filas.port';
import type {
  CatalogoPort,
  EventStorePort,
  GeneradorIdsPort,
  JornadasPort,
  NotificadorPort,
  PerfilAsociadoPort,
  RelojPort,
} from '../ports/out/otros.ports';
import type { TurnoRepository } from '../ports/out/turno.repository';
import { esCambioSimultaneo } from '../cambiar-turno';
import { resumir, ResumenTurno } from '../resumen-turno';
import { publicarEventos } from './publicar-eventos';

/**
 * CU-02 Solicitar turno. Orden de escritura (consistencia entre motores, sección 10):
 * 1) PostgreSQL (RN-01 por índice único)  2) motor de filas (idempotente)
 * 3) estado En espera o Próximo  4) eventos en MongoDB  5) aviso por Socket.IO.
 */
export class SolicitarTurnoService implements SolicitarTurnoUseCase {
  constructor(
    private readonly turnos: TurnoRepository,
    private readonly catalogo: CatalogoPort,
    private readonly perfiles: PerfilAsociadoPort,
    private readonly motor: MotorFilasPort,
    private readonly eventos: EventStorePort,
    private readonly notificador: NotificadorPort,
    private readonly ids: GeneradorIdsPort,
    private readonly reloj: RelojPort,
    /** RN-13: si el directivo cerró la jornada antes de la hora, la agencia ya no recibe turnos hoy. */
    private readonly jornadas?: JornadasPort,
  ) {}

  async ejecutar(comando: SolicitarTurnoComando): Promise<ResumenTurno> {
    const previo = await this.turnos.buscarPorIdempotencia(comando.asociadoId, comando.idempotencyKey);
    if (previo) return resumir(previo, null);

    const ahora = this.reloj.ahora();
    const fila = await this.catalogo.obtenerFila(comando.agenciaId, comando.servicioId);
    if (!fila || !fila.activa) {
      throw new NoEncontradoError('FILA_NO_EXISTE', 'La agencia no ofrece ese servicio');
    }
    if (!fila.estaAbierta(ahora)) {
      throw new ReglaNegocioError(
        'AGENCIA_CERRADA',
        `La agencia atiende de ${fila.horario.apertura} a ${fila.horario.cierre}`,
      );
    }
    if (await this.jornadas?.estaCerrada(comando.agenciaId, fechaLocal(ahora))) {
      throw new ReglaNegocioError('JORNADA_CERRADA', 'La agencia cerró la jornada de hoy. Puedes pedir turno en otra agencia o mañana.');
    }

    const tipo = PoliticaPreferencial.tipoAtencion({
      fechaNacimiento: await this.perfiles.fechaNacimiento(comando.asociadoId),
      autodeclarada: comando.solicitaPreferencial,
      hoy: ahora,
      edadMinima: fila.parametros.edadAdultoMayor,
    });

    const turno = Turno.solicitar({
      id: this.ids.nuevo(),
      agenciaId: comando.agenciaId,
      servicioId: comando.servicioId,
      asociadoId: comando.asociadoId,
      tipoAtencion: tipo,
      canal: comando.canal,
      ahora,
      idempotencyKey: comando.idempotencyKey,
    });

    try {
      await this.turnos.guardarNuevo(turno);
    } catch (error) {
      // Dos solicitudes simultáneas con la misma clave: la segunda devuelve el turno de la primera.
      if (error instanceof ConflictoError) {
        const mismo = await this.turnos.buscarPorIdempotencia(comando.asociadoId, comando.idempotencyKey);
        if (mismo) return resumir(mismo, null);
      }
      throw error;
    }

    let encolado: ResultadoEncolar;
    try {
      encolado = await this.motor.encolar(fila.id, turno.id, tipo, fila.parametros.maxPreferencialesSeguidos);
    } catch {
      // Compensación: el turno no quedó en la fila, así que se cancela y libera RN-01.
      turno.cancelar('ERROR_ENCOLADO', null, ahora);
      await this.turnos.actualizar(turno);
      await publicarEventos(turno, this.eventos, this.ids);
      throw new ServicioNoDisponibleError('No se pudo encolar el turno; intente de nuevo');
    }

    turno.asignarNumero(encolado.numero, fila.codigoPara(encolado.numero));
    turno.ponerEnEspera(ahora);
    if (fila.debeMarcarseProximo(encolado.personasDelante)) {
      turno.marcarProximo(ahora);
    }
    try {
      await this.turnos.actualizar(turno);
    } catch (error) {
      if (!esCambioSimultaneo(error)) throw error;
      return this.alguienSeAdelanto(turno);
    }
    await publicarEventos(turno, this.eventos, this.ids);

    const resumen = resumir(turno, encolado.personasDelante);
    await this.notificador.filaActualizada(fila.id);
    await this.notificador.turnoActualizado(turno.asociadoId, resumen);
    return resumen;
  }

  /**
   * Entre encolar y guardar lo llamaron, lo cancelaron o cerró la agencia: manda ese cambio. De
   * esta solicitud solo falta su primer evento; los demás los publicó quien hizo el cambio.
   */
  private async alguienSeAdelanto(turno: Turno): Promise<ResumenTurno> {
    const solicitud = turno.extraerEventos().filter((evento) => evento.estadoAnterior === null);
    await this.eventos.publicar(solicitud.map((evento) => ({ ...evento, eventoId: this.ids.nuevo() })));

    const vigente = (await this.turnos.obtener(turno.id)) ?? turno;
    // Si terminó antes de entrar a la fila, quien lo terminó no tenía qué retirar.
    if (!vigente.estaPendiente()) await this.motor.retirar(vigente.filaId, vigente.id).catch(() => undefined);
    await this.notificador.filaActualizada(vigente.filaId);
    return resumir(vigente, null);
  }
}
