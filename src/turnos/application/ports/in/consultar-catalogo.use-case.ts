import type { AgenciaCatalogo } from '../out/otros.ports';

export const CONSULTAR_CATALOGO = Symbol('CONSULTAR_CATALOGO');

/** RF-06: agencias y servicios (con caché de 10 min en Redis). */
export interface ConsultarCatalogoUseCase {
  listarAgencias(): Promise<AgenciaCatalogo[]>;
}
