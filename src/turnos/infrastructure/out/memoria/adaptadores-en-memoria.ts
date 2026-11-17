import { ConflictoError } from '../../../../compartido/domain/errores';
import type { EstimadorPort, ParametrosEspera } from '../../../application/ports/out/estimador.port';
import type {
  CierreMotor,
  MotorFilasPort,
  ResultadoEncolar,
  TurnoEntregado,
} from '../../../application/ports/out/motor-filas.port';
import type {
  AgenciaCatalogo,
  CatalogoPort,
  CerrojoPort,
  JornadasPort,
  EventStorePort,
  GeneradorIdsPort,
  NotificadorPort,
  PerfilAsociadoPort,
  RelojPort,
} from '../../../application/ports/out/otros.ports';
import type { TurnoRepository } from '../../../application/ports/out/turno.repository';
import type { ResumenTurno } from '../../../application/resumen-turno';
import type { EventoTurnoPublicable } from '../../../domain/evento-turno';
import type { Fila } from '../../../domain/fila';
import type { TipoAtencion } from '../../../domain/tipos';
import { DatosTurno, Turno } from '../../../domain/turno';

/*
 * Adaptadores en memoria. Implementan los mismos puertos que los adaptadores reales, así que
 * los casos de uso se prueban sin bases de datos ni servicios externos: el beneficio directo
 * de la arquitectura hexagonal.
 */

export class TurnoRepositoryEnMemoria implements TurnoRepository {
  private readonly datos = new Map<string, DatosTurno>();

  async guardarNuevo(turno: Turno): Promise<void> {
    const t = turno.instantanea();
    for (const otro of this.datos.values()) {
      if (t.idempotencyKey && otro.asociadoId === t.asociadoId && otro.idempotencyKey === t.idempotencyKey) {
        throw new ConflictoError('SOLICITUD_DUPLICADA', 'Esta solicitud ya fue registrada');
      }
      if (otro.asociadoId === t.asociadoId && Turno.reconstruir(otro).estaActivo()) {
        throw new ConflictoError('TURNO_ACTIVO', 'Ya tienes un turno activo');
      }
    }
    this.datos.set(t.id, { ...t });
  }

  async actualizar(turno: Turno): Promise<void> {
    const t = turno.instantanea();
    const guardado = this.datos.get(t.id);
    if (!guardado || guardado.version !== t.version) {
      throw new ConflictoError('TURNO_MODIFICADO', 'El turno cambió mientras se procesaba');
    }
    this.datos.set(t.id, { ...t, version: t.version + 1 });
    turno.alGuardar(t.version + 1);
  }

  async obtener(id: string): Promise<Turno | null> {
    const d = this.datos.get(id);
    return d ? Turno.reconstruir(d) : null;
  }

  async buscarPorIdempotencia(asociadoId: string, clave: string): Promise<Turno | null> {
    const d = [...this.datos.values()].find((t) => t.asociadoId === asociadoId && t.idempotencyKey === clave);
    return d ? Turno.reconstruir(d) : null;
  }

  async buscarActivoDeAsociado(asociadoId: string): Promise<Turno | null> {
    const d = [...this.datos.values()].find(
      (t) => t.asociadoId === asociadoId && Turno.reconstruir(t).estaActivo(),
    );
    return d ? Turno.reconstruir(d) : null;
  }

  async buscarDelDiaPorEstado(fecha: string, estados: string[], agenciaId?: string): Promise<Turno[]> {
    return [...this.datos.values()]
      .filter((t) => t.fecha === fecha && estados.includes(t.estado) && (!agenciaId || t.agenciaId === agenciaId))
      .map((t) => Turno.reconstruir(t));
  }
}

/** Cerrojo en memoria: simula a otra instancia que ya tiene la revisión en curso. */
export class CerrojoEnMemoria implements CerrojoPort {
  readonly tomados = new Set<string>();
  async tomar(nombre: string): Promise<boolean> {
    if (this.tomados.has(nombre)) return false;
    this.tomados.add(nombre);
    return true;
  }
  async soltar(nombre: string): Promise<void> {
    this.tomados.delete(nombre);
  }
}

export class JornadasEnMemoria implements JornadasPort {
  readonly cerradas = new Set<string>();
  async cerrar(agenciaId: string, fecha: string): Promise<void> {
    this.cerradas.add(`${agenciaId}:${fecha}`);
  }
  async reabrir(agenciaId: string, fecha: string): Promise<boolean> {
    return this.cerradas.delete(`${agenciaId}:${fecha}`);
  }
  async estaCerrada(agenciaId: string, fecha: string): Promise<boolean> {
    return this.cerradas.has(`${agenciaId}:${fecha}`);
  }
}

interface EnFila {
  turnoId: string;
  numero: number;
}

/** Misma regla que el script Lua del motor de filas, para probar los casos de uso. */
export class MotorFilasEnMemoria implements MotorFilasPort {
  private readonly filas = new Map<string, { pref: EnFila[]; gen: EnFila[]; seq: number; racha: number }>();
  private readonly numeros = new Map<string, number>();
  fallarAlEncolar = false;

  async encolar(filaId: string, turnoId: string, tipo: TipoAtencion, k: number): Promise<ResultadoEncolar> {
    if (this.fallarAlEncolar) throw new Error('Motor de filas caído (simulado)');
    const fila = this.fila(filaId);
    let numero = this.numeros.get(turnoId);
    if (numero === undefined) {
      numero = ++fila.seq;
      this.numeros.set(turnoId, numero);
    }
    fila.pref = fila.pref.filter((t) => t.turnoId !== turnoId);
    fila.gen = fila.gen.filter((t) => t.turnoId !== turnoId);
    const destino = tipo === 'PREFERENCIAL' ? fila.pref : fila.gen;
    destino.push({ turnoId, numero });
    destino.sort((a, b) => a.numero - b.numero);
    return { numero, personasDelante: (await this.personasDelante(filaId, turnoId, k)) ?? 0 };
  }

  async siguiente(filaId: string, k: number): Promise<TurnoEntregado | null> {
    const fila = this.fila(filaId);
    const usarPref = fila.pref.length > 0 && (fila.racha < k || fila.gen.length === 0);
    const origen = usarPref ? fila.pref : fila.gen;
    const turno = origen.shift();
    if (!turno) return null;
    fila.racha = usarPref ? fila.racha + 1 : 0;
    return { turnoId: turno.turnoId, numero: turno.numero, tipoAtencion: usarPref ? 'PREFERENCIAL' : 'GENERAL' };
  }

  async personasDelante(filaId: string, turnoId: string, k: number): Promise<number | null> {
    const fila = this.fila(filaId);
    const r = fila.pref.findIndex((t) => t.turnoId === turnoId);
    if (r >= 0) return r + Math.min(fila.gen.length, Math.floor(r / k));
    const g = fila.gen.findIndex((t) => t.turnoId === turnoId);
    if (g >= 0) return g + Math.min(fila.pref.length, k * (g + 1));
    return null;
  }

  async retirar(filaId: string, turnoId: string): Promise<void> {
    const fila = this.fila(filaId);
    fila.pref = fila.pref.filter((t) => t.turnoId !== turnoId);
    fila.gen = fila.gen.filter((t) => t.turnoId !== turnoId);
  }

  caido = false;

  async cerrarAgencia(agenciaId: string, servicioIds: string[]): Promise<CierreMotor> {
    if (this.caido) throw new Error('Motor de filas caído (simulado)');
    const retirados: string[] = [];
    for (const servicioId of servicioIds) {
      const fila = this.filas.get(`${agenciaId}:${servicioId}`);
      if (!fila) continue;
      retirados.push(...fila.pref.map((t) => t.turnoId), ...fila.gen.map((t) => t.turnoId));
      fila.pref.length = 0;
      fila.gen.length = 0;
    }
    return { retirados, duracionMs: 1 };
  }

  private fila(filaId: string) {
    let fila = this.filas.get(filaId);
    if (!fila) {
      fila = { pref: [], gen: [], seq: 0, racha: 0 };
      this.filas.set(filaId, fila);
    }
    return fila;
  }
}

export class EventStoreEnMemoria implements EventStorePort {
  readonly eventos: EventoTurnoPublicable[] = [];

  async publicar(eventos: EventoTurnoPublicable[]): Promise<void> {
    for (const evento of eventos) {
      if (!this.eventos.some((e) => e.eventoId === evento.eventoId)) this.eventos.push(evento);
    }
  }
}

export class NotificadorEnMemoria implements NotificadorPort {
  readonly filas: string[] = [];
  readonly turnos: Array<{ asociadoId: string; resumen: ResumenTurno }> = [];

  async filaActualizada(filaId: string): Promise<void> {
    this.filas.push(filaId);
  }

  async turnoActualizado(asociadoId: string, resumen: ResumenTurno): Promise<void> {
    this.turnos.push({ asociadoId, resumen });
  }
}

export class CatalogoEnMemoria implements CatalogoPort {
  constructor(private readonly filas: Fila[]) {}

  /** Simula un cambio de la administración ya visible (caché invalidada): misma fila, datos nuevos. */
  reemplazar(fila: Fila): void {
    const i = this.filas.findIndex((f) => f.agenciaId === fila.agenciaId && f.servicioId === fila.servicioId);
    this.filas.splice(i, 1, fila);
  }

  async obtenerFila(agenciaId: string, servicioId: string): Promise<Fila | null> {
    return this.filas.find((f) => f.agenciaId === agenciaId && f.servicioId === servicioId) ?? null;
  }

  async listarAgencias(): Promise<AgenciaCatalogo[]> {
    const ids = [...new Set(this.filas.map((f) => f.agenciaId))];
    return ids.map((id) => ({
      id,
      codigo: id.slice(-4),
      nombre: `Agencia ${id.slice(-4)}`,
      municipio: 'Prueba',
      activa: true,
      servicios: this.filas
        .filter((f) => f.agenciaId === id)
        .map((f) => ({ id: f.servicioId, codigo: f.prefijoTurno, nombre: f.prefijoTurno, prefijo: f.prefijoTurno, ventanillas: f.ventanillas })),
    }));
  }
}

export class PerfilAsociadoEnMemoria implements PerfilAsociadoPort {
  constructor(private readonly fechas: Record<string, Date | null> = {}) {}

  async fechaNacimiento(asociadoId: string): Promise<Date | null> {
    return this.fechas[asociadoId] ?? null;
  }
}

export class EstimadorEnMemoria implements EstimadorPort {
  constructor(private readonly respuesta: ParametrosEspera | null = { tAtencionMin: 4, pPreferencial: 0.2 }) {}

  async parametros(): Promise<ParametrosEspera | null> {
    return this.respuesta;
  }
}

export class RelojFijo implements RelojPort {
  constructor(private instante: Date) {}

  ahora(): Date {
    return this.instante;
  }

  avanzar(minutos: number): void {
    this.instante = new Date(this.instante.getTime() + minutos * 60_000);
  }
}

export class GeneradorIdsSecuencial implements GeneradorIdsPort {
  private contador = 0;

  nuevo(): string {
    this.contador++;
    return `00000000-0000-4000-8000-${String(this.contador).padStart(12, '0')}`;
  }
}
