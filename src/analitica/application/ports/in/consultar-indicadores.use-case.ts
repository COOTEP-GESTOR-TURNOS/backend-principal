import type { Principal } from '../../../../compartido/domain/principal';

export const CONSULTAR_INDICADORES = Symbol('CONSULTAR_INDICADORES');

export interface ValoresIndicadores {
  atendidos: number;
  cancelados: number;
  ausentes: number;
  esperaPromedioMin: number;
  atencionPromedioMin: number;
  /** Proporción de turnos preferenciales (0 a 1). */
  proporcionPreferencial: number;
}

export interface IndicadoresAgencia extends ValoresIndicadores {
  agenciaId: string;
  nombre: string;
  /** false si la analítica no respondió para esta agencia: sus valores no entran al total. */
  disponible: boolean;
}

export interface TableroIndicadores {
  desde: string;
  hasta: string;
  /** GLOBAL: el superadministrador ve todas las agencias; AGENCIA: una o las de su ámbito. */
  ambito: 'GLOBAL' | 'AGENCIA';
  agencias: IndicadoresAgencia[];
  /** Suma de los conteos y promedios ponderados de las agencias disponibles. */
  total: ValoresIndicadores;
}

/** Puerto de entrada (RF-19, CU-05): indicadores de turnos dentro del ámbito del administrador. */
export interface ConsultarIndicadoresUseCase {
  ejecutar(actor: Principal, cmd: { agenciaId?: string; desde?: string; hasta?: string; ip?: string }): Promise<TableroIndicadores>;
}
