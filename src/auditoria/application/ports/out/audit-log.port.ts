export const AUDIT_LOG = Symbol('AUDIT_LOG');

export interface EntradaAuditoria {
  /** 'GLOBAL' o el agencia_id del ámbito afectado. */
  ambito: string;
  actorId: string;
  actorRol: string;
  /** ROL_ASIGNADO, LOGIN_ADMIN, LOGIN_FALLIDO, PARAMETRO_CAMBIADO, TURNO_CANCELADO_POR_FUNCIONARIO, ... */
  accion: string;
  objetivoTipo: string;
  objetivoId: string;
  detalle?: Record<string, unknown>;
  ip?: string;
}

/** Puerto de salida: auditoría de solo inserción. No existe operación para borrar. */
export interface AuditLogPort {
  registrar(entrada: EntradaAuditoria): Promise<void>;
}
