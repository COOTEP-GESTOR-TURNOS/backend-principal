import type { EventoTurnoPublicable } from '../../../domain/evento-turno';
import type { Fila } from '../../../domain/fila';
import type { ResumenTurno } from '../../resumen-turno';

export const EVENT_STORE = Symbol('EVENT_STORE');
export const NOTIFICADOR = Symbol('NOTIFICADOR');
export const CATALOGO = Symbol('CATALOGO');
export const PERFIL_ASOCIADO = Symbol('PERFIL_ASOCIADO');
export const RELOJ = Symbol('RELOJ');
export const GENERADOR_IDS = Symbol('GENERADOR_IDS');
export const INVALIDADOR_CATALOGO = Symbol('INVALIDADOR_CATALOGO');
export const CERROJO = Symbol('CERROJO');
export const JORNADAS = Symbol('JORNADAS');

/** Historial de eventos (MongoDB). Idempotente por eventoId. */
export interface EventStorePort {
  publicar(eventos: EventoTurnoPublicable[]): Promise<void>;
}

/** Avisos en tiempo real (Socket.IO). */
export interface NotificadorPort {
  filaActualizada(filaId: string): Promise<void>;
  turnoActualizado(asociadoId: string, resumen: ResumenTurno): Promise<void>;
}

/** Datos de catálogo y parámetros de una fila (PostgreSQL con caché). */
export interface CatalogoPort {
  obtenerFila(agenciaId: string, servicioId: string): Promise<Fila | null>;
  /** RF-06: agencias con sus servicios, para elegir dónde pedir turno o asignar un funcionario. */
  listarAgencias(): Promise<AgenciaCatalogo[]>;
}

export interface ServicioCatalogo {
  id: string;
  codigo: string;
  nombre: string;
  prefijo: string;
  ventanillas: number;
}

export interface AgenciaCatalogo {
  id: string;
  codigo: string;
  nombre: string;
  municipio: string;
  activa: boolean;
  servicios: ServicioCatalogo[];
}

/**
 * Borra de la caché el catálogo de una agencia (o de todas) cuando la administración cambia
 * ventanillas, servicios, horario o parámetros: la siguiente lectura va a PostgreSQL.
 */
export interface InvalidadorCatalogoPort {
  invalidarAgencia(agenciaId: string): Promise<void>;
  invalidarTodo(): Promise<void>;
}

/**
 * Cerrojo distribuido: con varias instancias del backend, solo una revisa los vencimientos en
 * cada ciclo. Vence solo (TTL) si la instancia que lo tomó se cae.
 */
export interface CerrojoPort {
  tomar(nombre: string, ttlSegundos: number): Promise<boolean>;
  soltar(nombre: string): Promise<void>;
}

/**
 * Jornadas cerradas antes de su hora (RN-13). El horario dice si la agencia atiende a esta hora;
 * esta marca dice que hoy ya no recibe más turnos aunque el horario siga abierto.
 */
export interface JornadasPort {
  cerrar(agenciaId: string, fecha: string): Promise<void>;
  /** true si la jornada estaba cerrada. */
  reabrir(agenciaId: string, fecha: string): Promise<boolean>;
  estaCerrada(agenciaId: string, fecha: string): Promise<boolean>;
}

/** Datos del asociado que usan las reglas (fecha de nacimiento para RN-05). */
export interface PerfilAsociadoPort {
  fechaNacimiento(asociadoId: string): Promise<Date | null>;
}

export interface RelojPort {
  ahora(): Date;
}

export interface GeneradorIdsPort {
  nuevo(): string;
}
