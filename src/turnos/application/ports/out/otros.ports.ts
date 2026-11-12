import type { EventoTurnoPublicable } from '../../../domain/evento-turno';
import type { Fila } from '../../../domain/fila';
import type { ResumenTurno } from '../../resumen-turno';

export const EVENT_STORE = Symbol('EVENT_STORE');
export const NOTIFICADOR = Symbol('NOTIFICADOR');
export const CATALOGO = Symbol('CATALOGO');
export const PERFIL_ASOCIADO = Symbol('PERFIL_ASOCIADO');
export const RELOJ = Symbol('RELOJ');
export const GENERADOR_IDS = Symbol('GENERADOR_IDS');

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
