import { Inject, Injectable } from '@nestjs/common';
import { Client as ClienteCassandra, errors, types } from 'cassandra-driver';
import { DatosInvalidosError, ServicioNoDisponibleError } from '../../../compartido/application/errores-aplicacion';
import { CASSANDRA } from '../../../compartido/infrastructure/recursos';
import type {
  AuditoriaLecturaPort,
  OpcionesPagina,
  PaginaAuditoria,
  RegistroAuditoria,
} from '../../application/ports/out/auditoria-lectura.port';

function detalle(texto: string | null): Record<string, unknown> | null {
  if (!texto) return null;
  try {
    return JSON.parse(texto) as Record<string, unknown>;
  } catch {
    return { texto };
  }
}

/**
 * Lectura de la auditoría en Cassandra con paginación nativa (fetchSize + pageState): cada
 * página lee una sola partición y en el orden de la clave de agrupamiento (lo más reciente primero).
 */
@Injectable()
export class AuditoriaLecturaCassandraAdapter implements AuditoriaLecturaPort {
  constructor(@Inject(CASSANDRA) private readonly cassandra: ClienteCassandra) {}

  async porAmbitoDia(ambito: string, dia: string, opciones: OpcionesPagina & { accion?: string }): Promise<PaginaAuditoria> {
    // El filtro por acción va dentro de UNA partición (ámbito, día): ALLOW FILTERING no recorre el clúster.
    const porAccion = opciones.accion ? ' AND accion = ? ALLOW FILTERING' : '';
    const resultado = await this.ejecutar(
      `SELECT ambito, ocurrido_en, actor_id, actor_rol, accion, objetivo_tipo, objetivo_id, detalle, ip
         FROM auditoria_por_ambito_dia WHERE ambito = ? AND dia = ?${porAccion}`,
      [ambito, types.LocalDate.fromString(dia), ...(opciones.accion ? [opciones.accion] : [])],
      opciones,
    );
    return {
      registros: resultado.rows.map(
        (f): RegistroAuditoria => ({
          ocurridoEn: (f.ocurrido_en as types.TimeUuid).getDate(),
          ambito: f.ambito as string,
          actorId: String(f.actor_id),
          actorRol: (f.actor_rol as string | null) ?? null,
          accion: f.accion as string,
          objetivoTipo: (f.objetivo_tipo as string | null) ?? null,
          objetivoId: f.objetivo_id as string,
          detalle: detalle(f.detalle as string | null),
          ip: (f.ip as string | null) ?? null,
        }),
      ),
      siguiente: resultado.pageState ?? null,
    };
  }

  async porActorMes(actorId: string, mes: string, opciones: OpcionesPagina): Promise<PaginaAuditoria> {
    const resultado = await this.ejecutar(
      'SELECT ocurrido_en, actor_id, accion, ambito, objetivo_id FROM auditoria_por_actor WHERE actor_id = ? AND mes = ?',
      [types.Uuid.fromString(actorId), mes],
      opciones,
    );
    return {
      registros: resultado.rows.map(
        (f): RegistroAuditoria => ({
          ocurridoEn: (f.ocurrido_en as types.TimeUuid).getDate(),
          ambito: f.ambito as string,
          actorId: String(f.actor_id),
          actorRol: null,
          accion: f.accion as string,
          objetivoTipo: null,
          objetivoId: f.objetivo_id as string,
          detalle: null,
          ip: null,
        }),
      ),
      siguiente: resultado.pageState ?? null,
    };
  }

  private async ejecutar(consulta: string, parametros: unknown[], opciones: OpcionesPagina): Promise<types.ResultSet> {
    try {
      return await this.cassandra.execute(consulta, parametros, {
        prepare: true,
        fetchSize: opciones.limite,
        ...(opciones.siguiente ? { pageState: opciones.siguiente } : {}),
      });
    } catch (error) {
      if (
        opciones.siguiente &&
        error instanceof errors.ResponseError &&
        error.code === types.responseErrorCodes.protocolError &&
        error.message === 'Invalid value for the paging state'
      ) {
        throw new DatosInvalidosError('CURSOR_AUDITORIA_INVALIDO', 'El cursor de auditoría no es válido. Vuelve a la primera página.');
      }
      throw new ServicioNoDisponibleError(`No se pudo leer la auditoría: ${String(error)}`);
    }
  }
}
