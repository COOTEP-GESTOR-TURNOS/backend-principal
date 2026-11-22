import type { EstadoTurno } from '../domain/estado-turno';
import type { TipoAtencion } from '../domain/tipos';
import type { Turno } from '../domain/turno';

/** Lo que ven el asociado y el funcionario de un turno. No incluye datos personales. */
export interface ResumenTurno {
  id: string;
  codigo: string | null;
  estado: EstadoTurno;
  tipoAtencion: TipoAtencion;
  agenciaId: string;
  servicioId: string;
  personasDelante: number | null;
  /** RN-10: ya confirmó que viene. Así lo saben todos sus dispositivos. */
  confirmado: boolean;
  /** Por qué terminó: CANCELADO_POR_ASOCIADO, SIN_CONFIRMAR, NO_SE_PRESENTO, ... */
  motivo: string | null;
}

export function resumir(turno: Turno, personasDelante: number | null): ResumenTurno {
  return {
    id: turno.id,
    codigo: turno.codigo,
    estado: turno.estado,
    tipoAtencion: turno.tipoAtencion,
    agenciaId: turno.agenciaId,
    servicioId: turno.servicioId,
    personasDelante,
    confirmado: turno.confirmado,
    motivo: turno.motivo,
  };
}
