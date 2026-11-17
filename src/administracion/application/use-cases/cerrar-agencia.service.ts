import type { AuditLogPort } from '../../../auditoria/application/ports/out/audit-log.port';
import { ServicioNoDisponibleError } from '../../../compartido/application/errores-aplicacion';
import { ConflictoError, NoEncontradoError, PermisoDenegadoError } from '../../../compartido/domain/errores';
import type { Principal } from '../../../compartido/domain/principal';
import { fechaLocal, horaLocal } from '../../../compartido/domain/tiempo';
import { PoliticaAdministracion as Politica } from '../../../identidad/domain/politica-administracion';
import { rolPrincipal } from '../../../identidad/domain/usuario';
import type { CierreMotor, MotorFilasPort } from '../../../turnos/application/ports/out/motor-filas.port';
import type {
  CatalogoPort,
  CerrojoPort,
  EventStorePort,
  GeneradorIdsPort,
  JornadasPort,
  NotificadorPort,
  RelojPort,
} from '../../../turnos/application/ports/out/otros.ports';
import type { TurnoRepository } from '../../../turnos/application/ports/out/turno.repository';
import { resumir } from '../../../turnos/application/resumen-turno';
import { publicarEventos } from '../../../turnos/application/use-cases/publicar-eventos';
import { EstadoTurno } from '../../../turnos/domain/estado-turno';
import type { Turno } from '../../../turnos/domain/turno';
import type { CerrarAgenciaUseCase, ResultadoCierre } from '../ports/in/cerrar-agencia.use-case';
import type { AgenciasAdminRepository } from '../ports/out/agencias-admin.repository';

export const MOTIVO_CIERRE = 'CIERRE_AGENCIA';
const SISTEMA = '00000000-0000-0000-0000-000000000000';
const PENDIENTES = [EstadoTurno.SOLICITADO, EstadoTurno.EN_ESPERA, EstadoTurno.PROXIMO];
/** El cerrojo diario dura más que un día: el cierre automático corre una sola vez por fecha. */
const TTL_CIERRE_DIARIO_SEG = 36 * 60 * 60;

/**
 * Cierre de la jornada de una agencia (RN-13). Primero el motor vacía en paralelo todas sus
 * filas: desde ese momento nadie puede llamar un turno pendiente. Después cada turno pendiente
 * queda CANCELADO con motivo CIERRE_AGENCIA, en paralelo y con bloqueo optimista, y su asociado
 * recibe el aviso. Los turnos llamados o en atención siguen hasta terminar.
 */
export class CerrarAgenciaService implements CerrarAgenciaUseCase {
  constructor(
    private readonly agencias: AgenciasAdminRepository,
    private readonly turnos: TurnoRepository,
    private readonly motor: MotorFilasPort,
    private readonly catalogo: CatalogoPort,
    private readonly eventos: EventStorePort,
    private readonly notificador: NotificadorPort,
    private readonly ids: GeneradorIdsPort,
    private readonly reloj: RelojPort,
    private readonly cerrojo: CerrojoPort,
    private readonly auditoria: AuditLogPort,
    private readonly jornadas: JornadasPort,
  ) {}

  async cerrarJornada(actor: Principal | null, agenciaId: string, ip?: string): Promise<ResultadoCierre> {
    if (actor) await this.exigirAmbito(actor, agenciaId, 'JORNADA_CERRADA', ip);
    const agencia = await this.cargar(agenciaId);

    const ahora = this.reloj.ahora();
    const fecha = fechaLocal(ahora);
    // Primero la marca: desde aquí la agencia no recibe turnos nuevos y nada entra a una fila que se vacía.
    const yaCerrada = await this.jornadas.estaCerrada(agenciaId, fecha);
    await this.jornadas.cerrar(agenciaId, fecha);
    let cierre: CierreMotor;
    try {
      cierre = await this.motor.cerrarAgencia(agenciaId, agencia.servicios.map((s) => s.servicioId));
    } catch (error) {
      // Sin vaciar el motor no se cancela nada: un turno cancelado no puede quedar en una cola.
      if (!yaCerrada) await this.jornadas.reabrir(agenciaId, fecha);
      if (error instanceof ServicioNoDisponibleError) throw error;
      throw new ServicioNoDisponibleError(`El motor de filas no cerró la agencia: ${String(error)}`);
    }

    const pendientes = await this.turnos.buscarDelDiaPorEstado(fecha, PENDIENTES, agenciaId);
    const resultados = await Promise.allSettled(pendientes.map((t) => this.cancelar(t, actor?.id ?? null, ahora)));
    const cancelados = resultados.filter((r) => r.status === 'fulfilled' && r.value).length;
    const enAtencion = await this.turnos.buscarDelDiaPorEstado(fecha, [EstadoTurno.LLAMADO, EstadoTurno.EN_ATENCION], agenciaId);
    await Promise.allSettled(agencia.servicios.map((s) => this.notificador.filaActualizada(`${agenciaId}:${s.servicioId}`)));

    const resultado: ResultadoCierre = {
      agenciaId,
      nombre: agencia.nombre,
      fecha,
      automatico: actor === null,
      cancelados,
      retiradosDelMotor: cierre.retirados.length,
      duracionMotorMs: cierre.duracionMs,
      siguenEnAtencion: enAtencion.length,
    };
    const { agenciaId: _a, nombre: _n, ...detalle } = resultado;
    await this.auditar(actor, 'JORNADA_CERRADA', agenciaId, detalle, ip);
    return resultado;
  }

  async cierreAutomatico(): Promise<ResultadoCierre[]> {
    const ahora = this.reloj.ahora();
    const fecha = fechaLocal(ahora);
    const hora = horaLocal(ahora);
    const resultados: ResultadoCierre[] = [];
    for (const agencia of await this.catalogo.listarAgencias()) {
      if (agencia.servicios.length === 0) continue;
      const fila = await this.catalogo.obtenerFila(agencia.id, agencia.servicios[0].id);
      if (!fila || hora < fila.horario.cierre) continue;
      if (await this.jornadas.estaCerrada(agencia.id, fecha)) continue; // el directivo ya la cerró hoy
      const nombreCerrojo = `cierre:${agencia.id}:${fecha}`;
      if (!(await this.cerrojo.tomar(nombreCerrojo, TTL_CIERRE_DIARIO_SEG))) continue; // ya cerrada hoy
      try {
        resultados.push(await this.cerrarJornada(null, agencia.id));
      } catch {
        await this.cerrojo.soltar(nombreCerrojo); // se reintenta en el siguiente ciclo
      }
    }
    return resultados;
  }

  async reabrirJornada(actor: Principal, agenciaId: string, ip?: string) {
    await this.exigirAmbito(actor, agenciaId, 'JORNADA_REABIERTA', ip);
    await this.cargar(agenciaId);
    const fecha = fechaLocal(this.reloj.ahora());
    const reabierta = await this.jornadas.reabrir(agenciaId, fecha);
    if (reabierta) await this.auditar(actor, 'JORNADA_REABIERTA', agenciaId, { fecha }, ip);
    return { agenciaId, fecha, reabierta };
  }

  jornadaCerrada(agenciaId: string): Promise<boolean> {
    return this.jornadas.estaCerrada(agenciaId, fechaLocal(this.reloj.ahora()));
  }

  /** RN-15: fuera de su agencia, 403 y registro en la auditoría. */
  private async exigirAmbito(actor: Principal, agenciaId: string, accion: string, ip?: string): Promise<void> {
    if (Politica.puedeAdministrarAgencia(actor, agenciaId)) return;
    await this.auditar(actor, 'INTENTO_FUERA_DE_AMBITO', agenciaId, { accion }, ip);
    throw new PermisoDenegadoError('FUERA_DE_AMBITO', 'Solo puedes cerrar o reabrir la jornada de tu agencia');
  }

  private async cargar(agenciaId: string) {
    const agencia = await this.agencias.obtener(agenciaId);
    if (!agencia) throw new NoEncontradoError('AGENCIA_NO_ENCONTRADA', 'La agencia no existe');
    return agencia;
  }

  /** Cancela un turno pendiente; si alguien lo cambió en ese instante, lo relee e intenta otra vez. */
  private async cancelar(turno: Turno, actorId: string | null, ahora: Date): Promise<boolean> {
    let actual: Turno | null = turno;
    for (let intento = 0; intento < 2 && actual; intento++) {
      if (!PENDIENTES.includes(actual.estado) || !actual.cancelar(MOTIVO_CIERRE, actorId, ahora)) return false;
      try {
        await this.turnos.actualizar(actual);
        await publicarEventos(actual, this.eventos, this.ids);
        await this.notificador.turnoActualizado(actual.asociadoId, resumir(actual, null));
        return true;
      } catch (error) {
        if (!(error instanceof ConflictoError)) throw error;
        actual = await this.turnos.obtener(turno.id);
      }
    }
    return false;
  }

  private auditar(actor: Principal | null, accion: string, agenciaId: string, detalle: Record<string, unknown>, ip?: string) {
    return this.auditoria.registrar({
      ambito: agenciaId,
      actorId: actor?.id ?? SISTEMA,
      actorRol: actor ? rolPrincipal(actor.roles) : 'SISTEMA',
      accion,
      objetivoTipo: 'AGENCIA',
      objetivoId: agenciaId,
      detalle,
      ip,
    });
  }
}
