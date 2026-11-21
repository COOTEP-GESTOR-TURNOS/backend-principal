export const CATALOGO_FILTROS = Symbol('CATALOGO_FILTROS');

export interface OfertaAnalitica {
  agenciaId: string;
  servicioId: string;
  nombre: string;
  activa: boolean;
}

export interface ColaboradorAnalitica {
  id: string;
  nombre: string;
}

export interface ColaboradorVigente extends ColaboradorAnalitica {
  agenciaId: string;
}

export interface CatalogoFiltrosPort {
  ofertas(agenciaIds: string[]): Promise<OfertaAnalitica[]>;
  colaboradoresVigentes(agenciaIds: string[], servicioId?: string): Promise<ColaboradorVigente[]>;
  nombresColaboradores(ids: string[]): Promise<ColaboradorAnalitica[]>;
  nombresServicios(ids: string[]): Promise<{ id: string; nombre: string }[]>;
}
