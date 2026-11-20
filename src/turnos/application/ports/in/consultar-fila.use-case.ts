import type { SolicitudPagina } from '../../../../compartido/domain/paginacion';
import type { Principal } from '../../../../compartido/domain/principal';
import type { PaginaTurnos } from '../out/motor-filas.port';

export const CONSULTAR_FILA = Symbol('CONSULTAR_FILA');

export interface ConsultarFilaComando extends SolicitudPagina {
  agenciaId: string;
  servicioId: string;
  funcionario: Principal;
}

export interface ConsultarFilaUseCase {
  ejecutar(comando: ConsultarFilaComando): Promise<PaginaTurnos>;
}
