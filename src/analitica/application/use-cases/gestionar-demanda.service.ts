import type { AuditLogPort } from '../../../auditoria/application/ports/out/audit-log.port';
import { DatosInvalidosError } from '../../../compartido/application/errores-aplicacion';
import { NoEncontradoError, PermisoDenegadoError } from '../../../compartido/domain/errores';
import type { Principal } from '../../../compartido/domain/principal';
import { PoliticaAdministracion } from '../../../identidad/domain/politica-administracion';
import { rolPrincipal } from '../../../identidad/domain/usuario';
import type { CatalogoPort } from '../../../turnos/application/ports/out/otros.ports';
import type { DatosEventoAgencia, DemandaPort, FiltrosIndicadores, RangoAnalitica } from '../ports/out/demanda.port';
import { ubicacionAgenciaPutumayo } from '../ubicacion-agencia';
import { FiltrosAnaliticaService, rangoDelMes } from './filtros-analitica.service';

export class GestionarDemandaService {
  constructor(
    private readonly catalogo: CatalogoPort,
    private readonly demanda: DemandaPort,
    private readonly auditoria: AuditLogPort,
    private readonly filtros: FiltrosAnaliticaService,
  ) {}

  async calendario(actor: Principal, agenciaId: string, mes: string, ip?: string, servicioId?: string) {
    const { municipio, activa } = await this.agenciaAutorizada(actor, agenciaId, 'CONSULTAR_DEMANDA', ip);
    const ubicacion = { ...ubicacionAgenciaPutumayo(municipio), activa };
    if (!servicioId) return this.demanda.calendario(agenciaId, mes, ubicacion);
    const ofertas = await this.filtros.validar([agenciaId], rangoDelMes(mes), { servicioId });
    return this.demanda.calendario(agenciaId, mes, { ...ubicacion, servicioId, servicioActivo: ofertas.get(agenciaId) });
  }

  async tablero(actor: Principal, mes: string, agenciaId?: string, ip?: string, filtros: FiltrosIndicadores = {}) {
    if (!agenciaId && !PoliticaAdministracion.esSuperadmin(actor)) {
      throw new PermisoDenegadoError('FUERA_DE_AMBITO', 'Selecciona una agencia que administras para consultar el tablero');
    }
    const agencias = agenciaId
      ? [await this.agenciaAutorizada(actor, agenciaId, 'CONSULTAR_TABLERO_MENSUAL', ip)]
      : await this.catalogo.listarAgencias();
    const ofertas = await this.filtros.validar(agencias.map(({ id }) => id), rangoDelMes(mes), filtros);
    const seleccionadas = agencias.filter(({ id }) => !filtros.servicioId || ofertas.has(id)).map(({ id, nombre, municipio, activa }) => ({
      agenciaId: id, nombre, municipio, activa, ...ubicacionAgenciaPutumayo(municipio),
      ...(filtros.servicioId ? { servicioActivo: ofertas.get(id) } : {}),
    }));
    return this.demanda.tablero(mes, seleccionadas, agenciaId ?? null, filtros);
  }

  async opciones(actor: Principal, rango: RangoAnalitica, agenciaId?: string, servicioId?: string, ip?: string) {
    if (agenciaId) {
      await this.agenciaAutorizada(actor, agenciaId, 'CONSULTAR_FILTROS_INDICADORES', ip);
      return this.filtros.opciones([agenciaId], rango, servicioId);
    }
    const permitidas = (await this.catalogo.listarAgencias())
      .filter(({ id }) => PoliticaAdministracion.puedeAdministrarAgencia(actor, id))
      .map(({ id }) => id);
    if (!permitidas.length && !PoliticaAdministracion.esSuperadmin(actor)) {
      throw new PermisoDenegadoError('FUERA_DE_AMBITO', 'Solo puedes consultar los filtros de las agencias que administras');
    }
    return this.filtros.opciones(permitidas, rango, servicioId);
  }

  async crearEvento(actor: Principal, agenciaId: string, datos: DatosEventoAgencia, ip?: string) {
    const accion = 'EVENTO_AGENCIA_CREADO';
    await this.agenciaAutorizada(actor, agenciaId, accion, ip);
    const evento = await this.demanda.crearEvento(agenciaId, datos);
    await this.auditar(actor, accion, agenciaId, 'EVENTO_AGENCIA', evento.id, { fecha: evento.fecha, tipo: evento.tipo }, ip);
    return evento;
  }

  async editarEvento(actor: Principal, agenciaId: string, eventoId: string, cambios: Partial<DatosEventoAgencia>, ip?: string) {
    const accion = 'EVENTO_AGENCIA_EDITADO';
    await this.agenciaAutorizada(actor, agenciaId, accion, ip);
    if (cambios.fecha === undefined && cambios.tipo === undefined) {
      throw new DatosInvalidosError('EVENTO_AGENCIA_SIN_CAMBIOS', 'Indica una fecha o un tipo de evento');
    }
    const evento = await this.demanda.editarEvento(agenciaId, eventoId, cambios);
    await this.auditar(actor, accion, agenciaId, 'EVENTO_AGENCIA', evento.id, { fecha: evento.fecha, tipo: evento.tipo }, ip);
    return evento;
  }

  async eliminarEvento(actor: Principal, agenciaId: string, eventoId: string, ip?: string) {
    const accion = 'EVENTO_AGENCIA_ELIMINADO';
    await this.agenciaAutorizada(actor, agenciaId, accion, ip);
    await this.demanda.eliminarEvento(agenciaId, eventoId);
    await this.auditar(actor, accion, agenciaId, 'EVENTO_AGENCIA', eventoId, {}, ip);
  }

  private async agenciaAutorizada(actor: Principal, agenciaId: string, accion: string, ip?: string) {
    if (!PoliticaAdministracion.puedeAdministrarAgencia(actor, agenciaId)) {
      await this.auditar(actor, 'INTENTO_FUERA_DE_AMBITO', agenciaId, 'DEMANDA_AGENCIA', agenciaId, { accion }, ip);
      throw new PermisoDenegadoError('FUERA_DE_AMBITO', 'Solo puedes acceder a la demanda y eventos de las agencias que administras');
    }
    const agencia = (await this.catalogo.listarAgencias()).find((item) => item.id === agenciaId);
    if (!agencia) throw new NoEncontradoError('AGENCIA_NO_ENCONTRADA', 'La agencia no existe');
    return agencia;
  }

  private auditar(actor: Principal, accion: string, agenciaId: string, objetivoTipo: string, objetivoId: string,
    detalle: Record<string, unknown>, ip?: string) {
    return this.auditoria.registrar({
      ambito: agenciaId,
      actorId: actor.id,
      actorRol: rolPrincipal(actor.roles),
      accion,
      objetivoTipo,
      objetivoId,
      detalle,
      ip,
    });
  }
}
