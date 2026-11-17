import { ConflictoError } from '../../../compartido/domain/errores';
import { fechaLocal } from '../../../compartido/domain/tiempo';
import { EstadoTurno } from '../../domain/estado-turno';
import type { Fila } from '../../domain/fila';
import type { Turno } from '../../domain/turno';
import { motivoDeVencimiento } from '../../domain/vencimientos';
import type { ResultadoRevision, RevisarVencimientosUseCase } from '../ports/in/revisar-vencimientos.use-case';
import type { MotorFilasPort } from '../ports/out/motor-filas.port';
import type {
  CatalogoPort,
  CerrojoPort,
  EventStorePort,
  GeneradorIdsPort,
  NotificadorPort,
  RelojPort,
} from '../ports/out/otros.ports';
import type { TurnoRepository } from '../ports/out/turno.repository';
import { resumir } from '../resumen-turno';
import { publicarEventos } from './publicar-eventos';

export const CERROJO_VENCIMIENTOS = 'vencimientos';
/** Menor que el intervalo del programador: un ciclo colgado no bloquea el siguiente. */
export const TTL_CERROJO_SEG = 25;

/**
 * Tarea programada de vencimientos (RN-10, RN-11). En cada ciclo, por cada turno activo del día:
 * 1) Próximo sin confirmar después de T_CONFIRMACION → Ausente (SIN_CONFIRMAR).
 * 2) Llamado que no pasó a atención después de T_LLAMADO → Ausente (NO_SE_PRESENTO).
 * 3) En espera con N_PROXIMO personas o menos delante → Próximo, con su aviso.
 * Guarda primero en PostgreSQL con bloqueo optimista: si el asociado confirmó en ese instante,
 * gana su acción y el turno se deja para el siguiente ciclo. Solo después lo retira del motor.
 */
export class RevisarVencimientosService implements RevisarVencimientosUseCase {
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

  async ejecutar(): Promise<ResultadoRevision> {
    const resultado: ResultadoRevision = { ejecutada: false, revisados: 0, proximos: 0, sinConfirmar: 0, noSePresento: 0, conflictos: 0, errores: 0 };
    if (!(await this.cerrojo.tomar(CERROJO_VENCIMIENTOS, TTL_CERROJO_SEG))) return resultado;
    resultado.ejecutada = true;
    try {
      const ahora = this.reloj.ahora();
      const activos = await this.turnos.buscarDelDiaPorEstado(fechaLocal(ahora), [
        EstadoTurno.EN_ESPERA,
        EstadoTurno.PROXIMO,
        EstadoTurno.LLAMADO,
      ]);
      const filasTocadas = new Set<string>();
      const filas = new Map<string, Fila | null>();
      for (const turno of activos) {
        resultado.revisados += 1;
        if (!filas.has(turno.filaId)) filas.set(turno.filaId, await this.catalogo.obtenerFila(turno.agenciaId, turno.servicioId));
        const fila = filas.get(turno.filaId);
        if (!fila) continue;
        try {
          const cambio = await this.revisar(turno, fila, ahora);
          if (cambio) {
            resultado[cambio] += 1;
            filasTocadas.add(turno.filaId);
          }
        } catch (error) {
          if (error instanceof ConflictoError) resultado.conflictos += 1;
          else resultado.errores += 1;
        }
      }
      // Un aviso por fila, no uno por turno: las pantallas vuelven a consultar su posición.
      await Promise.allSettled([...filasTocadas].map((filaId) => this.notificador.filaActualizada(filaId)));
      return resultado;
    } finally {
      await this.cerrojo.soltar(CERROJO_VENCIMIENTOS);
    }
  }

  private async revisar(turno: Turno, fila: Fila, ahora: Date): Promise<'sinConfirmar' | 'noSePresento' | 'proximos' | null> {
    const motivo = motivoDeVencimiento(turno.instantanea(), fila, ahora);
    if (motivo) {
      turno.marcarAusente(motivo, null, ahora);
      await this.turnos.actualizar(turno); // lanza ConflictoError si alguien lo cambió primero
      await this.motor.retirar(turno.filaId, turno.id); // idempotente; un Llamado ya no está en la cola
      await this.cerrar(turno, null);
      return motivo === 'SIN_CONFIRMAR' ? 'sinConfirmar' : 'noSePresento';
    }

    if (turno.estado === EstadoTurno.EN_ESPERA) {
      const personas = await this.motor.personasDelante(turno.filaId, turno.id, fila.parametros.maxPreferencialesSeguidos);
      if (personas !== null && fila.debeMarcarseProximo(personas)) {
        turno.marcarProximo(ahora);
        await this.turnos.actualizar(turno);
        await this.cerrar(turno, personas);
        return 'proximos';
      }
    }
    return null;
  }

  /** Publica el evento en MongoDB y avisa al asociado por su sala de Socket.IO. */
  private async cerrar(turno: Turno, personasDelante: number | null): Promise<void> {
    await publicarEventos(turno, this.eventos, this.ids);
    await this.notificador.turnoActualizado(turno.asociadoId, resumir(turno, personasDelante));
  }
}
