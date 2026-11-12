export enum EstadoTurno {
  SOLICITADO = 'SOLICITADO',
  EN_ESPERA = 'EN_ESPERA',
  PROXIMO = 'PROXIMO',
  LLAMADO = 'LLAMADO',
  EN_ATENCION = 'EN_ATENCION',
  ATENDIDO = 'ATENDIDO',
  CANCELADO = 'CANCELADO',
  AUSENTE = 'AUSENTE',
}

/** Estados que ocupan la regla RN-01 (un turno activo por asociado). */
export const ESTADOS_ACTIVOS: ReadonlySet<EstadoTurno> = new Set([
  EstadoTurno.SOLICITADO,
  EstadoTurno.EN_ESPERA,
  EstadoTurno.PROXIMO,
  EstadoTurno.LLAMADO,
  EstadoTurno.EN_ATENCION,
]);

/** RN-04: transiciones válidas. Cualquier otra lanza TransicionInvalidaError. */
export const TRANSICIONES: Readonly<Record<EstadoTurno, readonly EstadoTurno[]>> = {
  [EstadoTurno.SOLICITADO]: [EstadoTurno.EN_ESPERA, EstadoTurno.CANCELADO],
  [EstadoTurno.EN_ESPERA]: [EstadoTurno.PROXIMO, EstadoTurno.CANCELADO],
  [EstadoTurno.PROXIMO]: [EstadoTurno.LLAMADO, EstadoTurno.CANCELADO, EstadoTurno.AUSENTE],
  // EN_ESPERA desde LLAMADO: la condición preferencial no se verificó (RN-07).
  [EstadoTurno.LLAMADO]: [EstadoTurno.EN_ATENCION, EstadoTurno.AUSENTE, EstadoTurno.EN_ESPERA],
  [EstadoTurno.EN_ATENCION]: [EstadoTurno.ATENDIDO],
  [EstadoTurno.ATENDIDO]: [],
  [EstadoTurno.CANCELADO]: [],
  [EstadoTurno.AUSENTE]: [],
};

const NOMBRES_EVENTO: Readonly<Record<EstadoTurno, string>> = {
  [EstadoTurno.SOLICITADO]: 'TurnoSolicitado',
  [EstadoTurno.EN_ESPERA]: 'TurnoEnEspera',
  [EstadoTurno.PROXIMO]: 'TurnoProximo',
  [EstadoTurno.LLAMADO]: 'TurnoLlamado',
  [EstadoTurno.EN_ATENCION]: 'TurnoEnAtencion',
  [EstadoTurno.ATENDIDO]: 'TurnoAtendido',
  [EstadoTurno.CANCELADO]: 'TurnoCancelado',
  [EstadoTurno.AUSENTE]: 'TurnoAusente',
};

export function nombreEvento(estado: EstadoTurno): string {
  return NOMBRES_EVENTO[estado];
}
