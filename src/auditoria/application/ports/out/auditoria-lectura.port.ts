export const AUDITORIA_LECTURA = Symbol('AUDITORIA_LECTURA');
export const DIRECTORIO_USUARIOS = Symbol('DIRECTORIO_USUARIOS');

/** Un registro tal como quedó en Cassandra; nunca se edita ni se borra. */
export interface RegistroAuditoria {
  ocurridoEn: Date;
  ambito: string;
  actorId: string;
  actorRol: string | null;
  accion: string;
  objetivoTipo: string | null;
  objetivoId: string;
  detalle: Record<string, unknown> | null;
  ip: string | null;
}

export interface PaginaAuditoria {
  registros: RegistroAuditoria[];
  /** Estado de paginación de Cassandra; null cuando no hay más. */
  siguiente: string | null;
}

export interface OpcionesPagina {
  limite: number;
  siguiente?: string;
}

/**
 * Puerto de salida de lectura de la auditoría. Cada consulta va a una sola partición de las dos
 * tablas de Cassandra: (ámbito, día) o (persona, mes).
 */
export interface AuditoriaLecturaPort {
  porAmbitoDia(ambito: string, dia: string, opciones: OpcionesPagina & { accion?: string }): Promise<PaginaAuditoria>;
  porActorMes(actorId: string, mes: string, opciones: OpcionesPagina): Promise<PaginaAuditoria>;
}

/** Nombres y correos para mostrar quién hizo cada acción (PostgreSQL). */
export interface DirectorioUsuariosPort {
  buscar(ids: string[]): Promise<Map<string, { nombre: string; email: string }>>;
}
