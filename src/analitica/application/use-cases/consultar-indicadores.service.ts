import type { AuditLogPort } from '../../../auditoria/application/ports/out/audit-log.port';
import type { CachePort } from '../../../compartido/application/ports/cache.port';
import { NoEncontradoError, PermisoDenegadoError } from '../../../compartido/domain/errores';
import { metadatosPagina, resolverPagina } from '../../../compartido/domain/paginacion';
import type { Principal } from '../../../compartido/domain/principal';
import { fechaLocal } from '../../../compartido/domain/tiempo';
import { PoliticaAdministracion as Politica } from '../../../identidad/domain/politica-administracion';
import { rolPrincipal } from '../../../identidad/domain/usuario';
import type { CatalogoPort, RelojPort } from '../../../turnos/application/ports/out/otros.ports';
import type {
  ConsultaIndicadores,
  ConsultarIndicadoresUseCase,
  IndicadoresAgencia,
  TableroIndicadores,
  ValoresIndicadores,
} from '../ports/in/consultar-indicadores.use-case';
import type { AnaliticaPort, IndicadoresAnalitica } from '../ports/out/analitica.port';
import type { FiltrosIndicadores } from '../ports/out/demanda.port';
import { FiltrosAnaliticaService, validarRangoIndicadores } from './filtros-analitica.service';

/** cache:indicadores:{agencia}:{desde}:{hasta}: los hechos llegan por ETL, 5 min de atraso no cambia el tablero. */
export const TTL_INDICADORES_SEG = 5 * 60;
export const DIAS_POR_DEFECTO = 30;

const DIA_MS = 24 * 60 * 60 * 1000;
const CERO: ValoresIndicadores = {
  atendidos: 0,
  cancelados: 0,
  ausentes: 0,
  esperaPromedioMin: 0,
  atencionPromedioMin: 0,
  proporcionPreferencial: 0,
};

const restarDias = (fecha: string, dias: number) => new Date(Date.parse(fecha) - dias * DIA_MS).toISOString().slice(0, 10);
const redondear = (valor: number, decimales: number) => Math.round(valor * 10 ** decimales) / 10 ** decimales;

/**
 * Total de varias agencias. Los conteos se suman; la espera y la atención se ponderan por los
 * turnos atendidos y la proporción preferencial por todos los turnos, como las calcula la analítica.
 */
export function totalizar(agencias: ValoresIndicadores[]): ValoresIndicadores {
  const atendidos = agencias.reduce((s, a) => s + a.atendidos, 0);
  const turnos = agencias.reduce((s, a) => s + a.atendidos + a.cancelados + a.ausentes, 0);
  const ponderar = (campo: 'esperaPromedioMin' | 'atencionPromedioMin') =>
    atendidos ? agencias.reduce((s, a) => s + a[campo] * a.atendidos, 0) / atendidos : 0;
  function sumarSiDisponible(campo: 'solicitados' | 'pendientes'): Partial<ValoresIndicadores> {
    const valores = agencias.map((agencia) => agencia[campo]);
    if (valores.every((valor) => valor === undefined)) return {};
    if (!valores.every((valor) => typeof valor === 'number')) return { [campo]: null };
    return { [campo]: valores.reduce((total, valor) => total + valor, 0) };
  }
  return {
    ...sumarSiDisponible('solicitados'),
    ...sumarSiDisponible('pendientes'),
    atendidos,
    cancelados: agencias.reduce((s, a) => s + a.cancelados, 0),
    ausentes: agencias.reduce((s, a) => s + a.ausentes, 0),
    esperaPromedioMin: redondear(ponderar('esperaPromedioMin'), 1),
    atencionPromedioMin: redondear(ponderar('atencionPromedioMin'), 1),
    proporcionPreferencial: turnos
      ? redondear(agencias.reduce((s, a) => s + a.proporcionPreferencial * (a.atendidos + a.cancelados + a.ausentes), 0) / turnos, 3)
      : 0,
  };
}

/**
 * Tablero de indicadores (RF-19, CU-05). El superadministrador ve todas las agencias; el
 * administrador de agencia solo la suya (RN-15), y pedir otra queda en la auditoría.
 * Las agencias se consultan en paralelo: una analítica lenta en una no frena a las demás.
 */
export class ConsultarIndicadoresService implements ConsultarIndicadoresUseCase {
  constructor(
    private readonly catalogo: CatalogoPort,
    private readonly analitica: AnaliticaPort,
    private readonly cache: CachePort,
    private readonly reloj: RelojPort,
    private readonly auditoria: AuditLogPort,
    private readonly filtros: FiltrosAnaliticaService,
  ) {}

  async ejecutar(actor: Principal, cmd: ConsultaIndicadores): Promise<TableroIndicadores> {
    const { desde, hasta } = this.rango(cmd.desde, cmd.hasta);
    const idsAutorizados = await this.ambito(actor, cmd.agenciaId, cmd.ip);
    const catalogo = await this.catalogo.listarAgencias();
    const ids = idsAutorizados ?? catalogo.map((a) => a.id);
    const nombres = new Map(catalogo.map((a) => [a.id, a.nombre]));
    const desconocida = ids.find((id) => !nombres.has(id));
    if (desconocida) throw new NoEncontradoError('AGENCIA_NO_ENCONTRADA', 'La agencia no existe');

    const filtros = { servicioId: cmd.servicioId, colaboradorId: cmd.colaboradorId };
    const ofertas = await this.filtros.validar(ids, { desde, hasta }, filtros);
    const seleccionadas = ids.filter((id) => !cmd.servicioId || ofertas.has(id));
    const resultados = await Promise.allSettled(seleccionadas.map((id) => this.leer(id, desde, hasta, filtros)));
    const agencias: IndicadoresAgencia[] = seleccionadas.map((id, i) => {
      const r = resultados[i];
      const valores = r.status === 'fulfilled' ? (r.value ?? CERO) : CERO;
      return { agenciaId: id, nombre: nombres.get(id)!, disponible: r.status === 'fulfilled', ...valores };
    });

    const tablero: TableroIndicadores = {
      desde,
      hasta,
      ambito: Politica.esSuperadmin(actor) && !cmd.agenciaId ? 'GLOBAL' : 'AGENCIA',
      agencias,
      total: totalizar(agencias.filter((a) => a.disponible)),
    };

    if (cmd.pagina === undefined && cmd.tamano === undefined) return tablero;

    const { desplazamiento, tamano } = resolverPagina(cmd);
    const orden = new Map(catalogo.map((agencia, i) => [agencia.id, i]));
    const ordenadas = [...agencias].sort((a, b) => orden.get(a.agenciaId)! - orden.get(b.agenciaId)!);
    return {
      ...tablero,
      agencias: ordenadas.slice(desplazamiento, desplazamiento + tamano),
      paginacion: metadatosPagina(cmd, agencias.length),
    };
  }

  /** Por defecto, los últimos 30 días hasta hoy (hora de Colombia). */
  private rango(desdePedido?: string, hastaPedido?: string): { desde: string; hasta: string } {
    const hasta = hastaPedido ?? fechaLocal(this.reloj.ahora());
    const desde = desdePedido ?? restarDias(hasta, DIAS_POR_DEFECTO - 1);
    validarRangoIndicadores({ desde, hasta });
    return { desde, hasta };
  }

  /** Agencias autorizadas. Sin filtro, el ámbito global abarca todo el catálogo. */
  private async ambito(actor: Principal, agenciaId: string | undefined, ip?: string): Promise<string[] | undefined> {
    if (Politica.esSuperadmin(actor)) {
      return agenciaId ? [agenciaId] : undefined;
    }
    const propias = Politica.agenciasAdministradas(actor);
    if (propias.length === 0) throw new PermisoDenegadoError('FUERA_DE_AMBITO', 'Tu rol no tiene indicadores que consultar');
    if (agenciaId && !propias.includes(agenciaId)) {
      await this.auditoria.registrar({
        ambito: agenciaId,
        actorId: actor.id,
        actorRol: rolPrincipal(actor.roles),
        accion: 'INTENTO_FUERA_DE_AMBITO',
        objetivoTipo: 'INDICADORES',
        objetivoId: agenciaId,
        ip,
      });
      throw new PermisoDenegadoError('FUERA_DE_AMBITO', 'Solo puedes ver los indicadores de tu agencia');
    }
    return agenciaId ? [agenciaId] : propias;
  }

  private async leer(agenciaId: string, desde: string, hasta: string, filtros: FiltrosIndicadores): Promise<IndicadoresAnalitica | null> {
    const filtrada = filtros.servicioId || filtros.colaboradorId;
    const consultar = () => filtrada
      ? this.analitica.indicadores(agenciaId, desde, hasta, filtros)
      : this.analitica.indicadores(agenciaId, desde, hasta);
    const sufijo = filtrada ? `:${filtros.servicioId ?? ''}:${filtros.colaboradorId ?? ''}` : '';
    const clave = `indicadores:${agenciaId}:${desde}:${hasta}${sufijo}`;
    const guardados = await this.cache.obtener<IndicadoresAnalitica>(clave);
    if (guardados) return guardados;
    const nuevos = await consultar();
    if (nuevos) await this.cache.guardar(clave, nuevos, TTL_INDICADORES_SEG);
    return nuevos;
  }
}
