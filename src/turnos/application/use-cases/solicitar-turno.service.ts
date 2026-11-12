import { ServicioNoDisponibleError } from '../../../compartido/application/errores-aplicacion';
import { ConflictoError, NoEncontradoError, ReglaNegocioError } from '../../../compartido/domain/errores';
import { PoliticaPreferencial } from '../../domain/politica-preferencial';
import { Turno } from '../../domain/turno';
import type { SolicitarTurnoComando, SolicitarTurnoUseCase } from '../ports/in/solicitar-turno.use-case';
import type { MotorFilasPort, ResultadoEncolar } from '../ports/out/motor-filas.port';
import type {
  CatalogoPort,
  EventStorePort,
  GeneradorIdsPort,
  NotificadorPort,
  PerfilAsociadoPort,
  RelojPort,
} from '../ports/out/otros.ports';
import type { TurnoRepository } from '../ports/out/turno.repository';
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
    await this.turnos.actualizar(turno);
    await publicarEventos(turno, this.eventos, this.ids);

    const resumen = resumir(turno, encolado.personasDelante);
    await this.notificador.filaActualizada(fila.id);
    await this.notificador.turnoActualizado(turno.asociadoId, resumen);
    return resumen;
  }
}
