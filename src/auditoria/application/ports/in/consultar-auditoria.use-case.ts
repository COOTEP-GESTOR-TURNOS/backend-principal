import type { Principal } from '../../../../compartido/domain/principal';

export const CONSULTAR_AUDITORIA = Symbol('CONSULTAR_AUDITORIA');

export interface EntradaVista {
  ocurridoEn: string; // ISO 8601
  ambito: string;
  accion: string;
  actor: { id: string; rol: string | null; nombre: string | null; email: string | null };
  objetivoTipo: string | null;
  objetivoId: string;
  detalle: Record<string, unknown> | null;
  ip: string | null;
}

export interface ResultadoAuditoria {
  entradas: EntradaVista[];
  siguiente: string | null;
  limite: number;
}

/** Puerto de entrada (RF-20, CU-06): el superadministrador consulta la auditoría; no hay forma de editarla. */
export interface ConsultarAuditoriaUseCase {
  porAmbitoDia(actor: Principal, cmd: { ambito: string; dia?: string; accion?: string; limite?: number; siguiente?: string }): Promise<ResultadoAuditoria & { ambito: string; dia: string }>;
  porActorMes(actor: Principal, cmd: { actorId: string; mes?: string; limite?: number; siguiente?: string }): Promise<ResultadoAuditoria & { actorId: string; mes: string }>;
}
