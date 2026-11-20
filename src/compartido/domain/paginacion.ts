export const PAGINA_PREDETERMINADA = 1;
export const TAMANO_PREDETERMINADO = 20;
export const TAMANO_MAXIMO = 100;
export const PAGINA_MAXIMA = 2_147_483_647;

export interface SolicitudPagina {
  pagina?: number;
  tamano?: number;
}

export interface Paginacion {
  pagina: number;
  tamano: number;
  total: number;
  totalPaginas: number;
}

export function resolverPagina(solicitud: SolicitudPagina) {
  const pagina = solicitud.pagina ?? PAGINA_PREDETERMINADA;
  const tamano = solicitud.tamano ?? TAMANO_PREDETERMINADO;
  return { pagina, tamano, desplazamiento: (pagina - 1) * tamano };
}

export function metadatosPagina(solicitud: SolicitudPagina, total: number): Paginacion {
  const { pagina, tamano } = resolverPagina(solicitud);
  return { pagina, tamano, total, totalPaginas: Math.ceil(total / tamano) };
}
