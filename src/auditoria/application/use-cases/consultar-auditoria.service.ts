import { NoEncontradoError, PermisoDenegadoError, ReglaNegocioError } from '../../../compartido/domain/errores';
import type { Principal } from '../../../compartido/domain/principal';
import { fechaLocal } from '../../../compartido/domain/tiempo';
import type { CatalogoPort, RelojPort } from '../../../turnos/application/ports/out/otros.ports';
import type { ConsultarAuditoriaUseCase, EntradaVista, ResultadoAuditoria } from '../ports/in/consultar-auditoria.use-case';
import type { AuditoriaLecturaPort, DirectorioUsuariosPort, PaginaAuditoria } from '../ports/out/auditoria-lectura.port';

export const LIMITE_POR_DEFECTO = 50;
export const LIMITE_MAXIMO = 200;

const esFecha = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

/**
 * Consulta de la auditoría (RF-20, CU-06). Solo el superadministrador la lee; nadie la edita ni la
 * borra (no existe esa operación). Cada página sale de una sola partición de Cassandra y se
 * completa con el nombre de quien actuó, leído de PostgreSQL.
 */
export class ConsultarAuditoriaService implements ConsultarAuditoriaUseCase {
  constructor(
    private readonly lectura: AuditoriaLecturaPort,
    private readonly directorio: DirectorioUsuariosPort,
    private readonly catalogo: CatalogoPort,
    private readonly reloj: RelojPort,
  ) {}

  async porAmbitoDia(actor: Principal, cmd: { ambito: string; dia?: string; accion?: string; limite?: number; siguiente?: string }) {
    this.exigirSuperadmin(actor);
    const hoy = fechaLocal(this.reloj.ahora());
    const dia = cmd.dia ?? hoy;
    if (!esFecha(dia) || dia > hoy) throw new ReglaNegocioError('FECHA_INVALIDA', 'Elige un día que ya haya ocurrido (AAAA-MM-DD)');
    if (cmd.ambito !== 'GLOBAL') {
      const agencias = await this.catalogo.listarAgencias();
      if (!agencias.some((a) => a.id === cmd.ambito)) throw new NoEncontradoError('AGENCIA_NO_ENCONTRADA', 'La agencia no existe');
    }
    const pagina = await this.lectura.porAmbitoDia(cmd.ambito, dia, {
      limite: this.limite(cmd.limite),
      siguiente: cmd.siguiente,
      accion: cmd.accion,
    });
    return { ambito: cmd.ambito, dia, ...(await this.completar(pagina)) };
  }

  async porActorMes(actor: Principal, cmd: { actorId: string; mes?: string; limite?: number; siguiente?: string }) {
    this.exigirSuperadmin(actor);
    const mes = cmd.mes ?? fechaLocal(this.reloj.ahora()).slice(0, 7);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) throw new ReglaNegocioError('MES_INVALIDO', 'El mes va como AAAA-MM');
    const pagina = await this.lectura.porActorMes(cmd.actorId, mes, { limite: this.limite(cmd.limite), siguiente: cmd.siguiente });
    return { actorId: cmd.actorId, mes, ...(await this.completar(pagina)) };
  }

  private limite(pedido?: number): number {
    return Math.min(Math.max(pedido ?? LIMITE_POR_DEFECTO, 1), LIMITE_MAXIMO);
  }

  /** Agrega nombre y correo de cada actor con una sola consulta por página. */
  private async completar(pagina: PaginaAuditoria): Promise<ResultadoAuditoria> {
    const ids = [...new Set(pagina.registros.map((r) => r.actorId))];
    const nombres = ids.length ? await this.directorio.buscar(ids) : new Map<string, { nombre: string; email: string }>();
    const entradas: EntradaVista[] = pagina.registros.map((r) => ({
      ocurridoEn: r.ocurridoEn.toISOString(),
      ambito: r.ambito,
      accion: r.accion,
      actor: { id: r.actorId, rol: r.actorRol, nombre: nombres.get(r.actorId)?.nombre ?? null, email: nombres.get(r.actorId)?.email ?? null },
      objetivoTipo: r.objetivoTipo,
      objetivoId: r.objetivoId,
      detalle: r.detalle,
      ip: r.ip,
    }));
    return { entradas, siguiente: pagina.siguiente };
  }

  private exigirSuperadmin(actor: Principal): void {
    if (!actor.roles.some((r) => r.rol === 'SUPERADMIN')) {
      throw new PermisoDenegadoError('FUERA_DE_AMBITO', 'Solo el superadministrador consulta la auditoría');
    }
  }
}
