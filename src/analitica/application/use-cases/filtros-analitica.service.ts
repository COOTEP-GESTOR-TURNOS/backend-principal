import { NoEncontradoError, ReglaNegocioError } from '../../../compartido/domain/errores';
import type { CatalogoFiltrosPort } from '../ports/out/catalogo-filtros.port';
import type { DemandaPort, FiltrosIndicadores, RangoAnalitica } from '../ports/out/demanda.port';

const DIA_MS = 24 * 60 * 60 * 1000;
export const DIAS_MAXIMOS = 366;

export function validarRangoIndicadores({ desde, hasta }: RangoAnalitica): void {
  if (desde > hasta) throw new ReglaNegocioError('RANGO_INVALIDO', 'La fecha inicial no puede ser posterior a la final');
  if ((Date.parse(hasta) - Date.parse(desde)) / DIA_MS >= DIAS_MAXIMOS) {
    throw new ReglaNegocioError('RANGO_INVALIDO', `El rango no puede pasar de ${DIAS_MAXIMOS} días`);
  }
}

export function rangoDelMes(mes: string): RangoAnalitica {
  const desde = `${mes}-01`;
  const ultimoDia = new Date(`${desde}T00:00:00Z`);
  ultimoDia.setUTCMonth(ultimoDia.getUTCMonth() + 1, 0);
  return { desde, hasta: ultimoDia.toISOString().slice(0, 10) };
}

interface OpcionAnalitica { id: string; nombre: string }

const porNombre = (a: OpcionAnalitica, b: OpcionAnalitica) => a.nombre.localeCompare(b.nombre, 'es-CO') || a.id.localeCompare(b.id);

/** El llamador siempre entrega las agencias que ya verificó para la sesión. */
export class FiltrosAnaliticaService {
  constructor(private readonly catalogo: CatalogoFiltrosPort, private readonly demanda: DemandaPort) {}

  async opciones(agenciaIds: string[], rango: RangoAnalitica, servicioId?: string) {
    validarRangoIndicadores(rango);
    if (!agenciaIds.length) return { servicios: [], colaboradores: [] };
    const [ofertas, historicas, vigentes] = await Promise.all([
      this.catalogo.ofertas(agenciaIds),
      this.demanda.opcionesHistoricas(rango, agenciaIds, servicioId),
      this.catalogo.colaboradoresVigentes(agenciaIds, servicioId),
    ]);
    const permitidas = new Set(agenciaIds);
    const actividad = historicas.filter(({ agenciaId }) => permitidas.has(agenciaId));
    const servicios = new Map(ofertas.filter(({ activa }) => activa).map(({ servicioId: id, nombre }) => [id, nombre]));
    const nombresOfertas = new Map(ofertas.map(({ servicioId: id, nombre }) => [id, nombre]));
    const serviciosFaltantes = new Set<string>();
    const historialColaboradores = new Map<string, Set<string>>();

    for (const fila of actividad) {
      const nombreServicio = nombresOfertas.get(fila.servicioId);
      if (nombreServicio !== undefined) servicios.set(fila.servicioId, nombreServicio);
      else serviciosFaltantes.add(fila.servicioId);
      if (!fila.colaboradorId || (servicioId && servicioId !== fila.servicioId)) continue;
      const agencias = historialColaboradores.get(fila.colaboradorId) ?? new Set<string>();
      agencias.add(fila.agenciaId);
      historialColaboradores.set(fila.colaboradorId, agencias);
    }

    const colaboradores = new Map<string, { id: string; nombre: string; agenciaIds: Set<string> }>();
    for (const { id, nombre, agenciaId } of vigentes) {
      if (!permitidas.has(agenciaId)) continue;
      const agencias = colaboradores.get(id)?.agenciaIds ?? new Set<string>();
      agencias.add(agenciaId);
      colaboradores.set(id, { id, nombre, agenciaIds: agencias });
    }

    const [otrosServicios, otrosColaboradores] = await Promise.all([
      this.catalogo.nombresServicios([...serviciosFaltantes]),
      this.catalogo.nombresColaboradores([...historialColaboradores.keys()].filter((id) => !colaboradores.has(id))),
    ]);
    for (const { id, nombre } of otrosServicios) servicios.set(id, nombre);
    for (const { id, nombre } of otrosColaboradores) colaboradores.set(id, { id, nombre, agenciaIds: new Set() });
    for (const [id, agencias] of historialColaboradores) {
      const colaborador = colaboradores.get(id);
      if (colaborador) for (const agenciaId of agencias) colaborador.agenciaIds.add(agenciaId);
    }

    return {
      servicios: [...servicios.entries()].map(([id, nombre]) => ({ id, nombre })).sort(porNombre),
      colaboradores: [...colaboradores.values()].map((colaborador) => ({
        ...colaborador, agenciaIds: [...colaborador.agenciaIds].sort(),
      })).sort(porNombre),
    };
  }

  /** Devuelve las agencias que ofrecen u ofrecieron el servicio, con su vigencia actual. */
  async validar(agenciaIds: string[], rango: RangoAnalitica, { servicioId, colaboradorId }: FiltrosIndicadores) {
    const ofertas = new Map<string, boolean>();
    if (!servicioId && !colaboradorId) return ofertas;
    if (!agenciaIds.length) throw new NoEncontradoError('AGENCIA_NO_ENCONTRADA', 'El ámbito consultado no contiene agencias');

    const [catalogo, vigentes] = await Promise.all([
      servicioId ? this.catalogo.ofertas(agenciaIds) : [],
      colaboradorId ? this.catalogo.colaboradoresVigentes(agenciaIds, servicioId) : [],
    ]);
    for (const oferta of catalogo) {
      if (oferta.servicioId === servicioId) ofertas.set(oferta.agenciaId, oferta.activa);
    }
    const colaboradorVigente = vigentes.some(({ id }) => id === colaboradorId);

    if ((servicioId && ofertas.size < agenciaIds.length) || (colaboradorId && !colaboradorVigente)) {
      const historicas = await this.demanda.opcionesHistoricas(rango, agenciaIds, servicioId);
      const permitidas = new Set(agenciaIds);
      let colaboradorHistorico = false;
      for (const fila of historicas) {
        if (!permitidas.has(fila.agenciaId) || (servicioId && fila.servicioId !== servicioId)) continue;
        if (servicioId && !ofertas.has(fila.agenciaId)) ofertas.set(fila.agenciaId, false);
        if (colaboradorId && fila.colaboradorId === colaboradorId) colaboradorHistorico = true;
      }
      if (colaboradorId && !colaboradorVigente && !colaboradorHistorico) {
        throw new NoEncontradoError('COLABORADOR_NO_ENCONTRADO', 'El colaborador no está disponible en el ámbito consultado');
      }
    }
    if (servicioId && !ofertas.size) {
      throw new NoEncontradoError('SERVICIO_NO_ENCONTRADO', 'El servicio no está disponible en el ámbito consultado');
    }
    return ofertas;
  }
}
