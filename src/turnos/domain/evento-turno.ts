import type { EstadoTurno } from './estado-turno';
import type { Canal, TipoAtencion } from './tipos';

/** Hecho ocurrido en la vida de un turno. Se guarda en MongoDB y alimenta la analítica. */
export interface EventoTurno {
  tipo: string;
  turnoId: string;
  agenciaId: string;
  servicioId: string;
  asociadoId: string;
  tipoAtencion: TipoAtencion;
  estadoAnterior: EstadoTurno | null;
  estadoNuevo: EstadoTurno;
  actorId: string | null;
  canal: Canal;
  ocurridoEn: Date;
  datos: Record<string, unknown>;
}

/** Evento con su identificador único: el índice único de MongoDB hace idempotente el reintento. */
export interface EventoTurnoPublicable extends EventoTurno {
  eventoId: string;
}
