import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { CatalogoFiltrosPort } from '../../src/analitica/application/ports/out/catalogo-filtros.port';
import type { CalendarioDemanda, DemandaPort, EventoAgencia } from '../../src/analitica/application/ports/out/demanda.port';
import { FiltrosAnaliticaService } from '../../src/analitica/application/use-cases/filtros-analitica.service';
import { GestionarDemandaService } from '../../src/analitica/application/use-cases/gestionar-demanda.service';
import { CambiosEventoAgenciaDto, DatosEventoAgenciaDto, MesDemandaDto, TableroMensualQuery } from '../../src/analitica/infrastructure/in/http/demanda.controller';
import { AnaliticaHttpAdapter } from '../../src/analitica/infrastructure/out/http/analitica-http.adapter';
import type { AuditLogPort } from '../../src/auditoria/application/ports/out/audit-log.port';
import { leerConfig } from '../../src/compartido/infrastructure/config';
import type { Principal } from '../../src/compartido/domain/principal';
import type { CatalogoPort } from '../../src/turnos/application/ports/out/otros.ports';

const PUTUMAYO = 'a0000000-0000-4000-8000-000000000002';
const SIN_DEPARTAMENTO = 'a0000000-0000-4000-8000-000000000003';
const CAJA = 'b0000000-0000-4000-8000-000000000001';
const CREDITO = 'b0000000-0000-4000-8000-000000000002';
const COLABORADOR = '11111111-0000-4000-8000-000000000006';
const RANGO = { desde: '2026-11-01', hasta: '2026-11-30' };
const EVENTO: EventoAgencia = { id: '90000000-0000-4000-8000-000000000001', fecha: '2026-11-20', tipo: 'PAGO_NOMINA' };
const SUPERADMIN: Principal = { id: '11111111-0000-4000-8000-000000000001', roles: [{ rol: 'SUPERADMIN' }] };
const ADMIN_AGENCIA: Principal = { ...SUPERADMIN, roles: [{ rol: 'ADMIN_AGENCIA', agenciaId: PUTUMAYO }] };
const CALENDARIO: CalendarioDemanda = {
  agenciaId: PUTUMAYO, mes: '2026-11', fuente: 'REAL', estadoPronostico: 'DISPONIBLE', dias: [],
};

function armar() {
  const catalogo: jest.Mocked<CatalogoPort> = {
    obtenerFila: jest.fn(),
    listarAgencias: jest.fn().mockResolvedValue([
      { id: PUTUMAYO, codigo: 'AG02', nombre: 'Agencia Puerto Asís', municipio: 'Puerto Asís', activa: true, servicios: [] },
      { id: SIN_DEPARTAMENTO, codigo: 'AG03', nombre: 'Agencia San Francisco', municipio: 'San Francisco', activa: true, servicios: [] },
    ]),
  };
  const demanda: jest.Mocked<DemandaPort> = {
    calendario: jest.fn().mockResolvedValue(CALENDARIO),
    tablero: jest.fn(),
    opcionesHistoricas: jest.fn().mockResolvedValue([]),
    crearEvento: jest.fn().mockResolvedValue(EVENTO),
    editarEvento: jest.fn().mockResolvedValue({ ...EVENTO, tipo: 'FESTIVO_LOCAL' }),
    eliminarEvento: jest.fn().mockResolvedValue(undefined),
  };
  const catalogoFiltros: jest.Mocked<CatalogoFiltrosPort> = {
    ofertas: jest.fn().mockResolvedValue([]), colaboradoresVigentes: jest.fn().mockResolvedValue([]),
    nombresColaboradores: jest.fn().mockResolvedValue([]), nombresServicios: jest.fn().mockResolvedValue([]),
  };
  const auditoria: jest.Mocked<AuditLogPort> = { registrar: jest.fn().mockResolvedValue(undefined) };
  const filtros = new FiltrosAnaliticaService(catalogoFiltros, demanda);
  return { servicio: new GestionarDemandaService(catalogo, demanda, auditoria, filtros), catalogo, catalogoFiltros, demanda, auditoria };
}

describe('Calendario de demanda y eventos por agencia', () => {
  it('obtiene el departamento del catálogo y deja sin resolver municipios homónimos', async () => {
    const { servicio, demanda } = armar();
    await expect(servicio.calendario(ADMIN_AGENCIA, PUTUMAYO, '2026-11')).resolves.toBe(CALENDARIO);
    await servicio.calendario(SUPERADMIN, SIN_DEPARTAMENTO, '2026-11');
    expect(demanda.calendario).toHaveBeenNthCalledWith(1, PUTUMAYO, '2026-11', {
      departamento: 'PUTUMAYO', municipio: 'Puerto Asís', activa: true,
    });
    expect(demanda.calendario).toHaveBeenNthCalledWith(2, SIN_DEPARTAMENTO, '2026-11', { activa: true });
  });

  it('limita el tablero mensual al ámbito autorizado y usa el catálogo para el total general', async () => {
    const { servicio, demanda } = armar();
    await expect(servicio.tablero(ADMIN_AGENCIA, '2026-11')).rejects.toMatchObject({ codigo: 'FUERA_DE_AMBITO' });
    await expect(servicio.tablero(ADMIN_AGENCIA, '2026-11', SIN_DEPARTAMENTO)).rejects.toMatchObject({ codigo: 'FUERA_DE_AMBITO' });
    await servicio.tablero(ADMIN_AGENCIA, '2026-11', PUTUMAYO);
    await servicio.tablero(SUPERADMIN, '2026-11');
    const asis = { agenciaId: PUTUMAYO, nombre: 'Agencia Puerto Asís', municipio: 'Puerto Asís', departamento: 'PUTUMAYO', activa: true };
    expect(demanda.tablero).toHaveBeenNthCalledWith(1, '2026-11', [asis], PUTUMAYO, {});
    expect(demanda.tablero).toHaveBeenNthCalledWith(2, '2026-11', [asis, {
      agenciaId: SIN_DEPARTAMENTO, nombre: 'Agencia San Francisco', municipio: 'San Francisco', activa: true,
    }], null, {});
    await expect(validate(plainToInstance(TableroMensualQuery, { mes: '2026-11', agenciaId: 'inválida' }))).resolves.toHaveLength(1);
  });

  it('ofrece servicios y colaboradores históricos con actividad del ámbito autorizado', async () => {
    const { servicio, demanda, catalogoFiltros } = armar();
    catalogoFiltros.ofertas.mockResolvedValue([
      { agenciaId: PUTUMAYO, servicioId: CAJA, nombre: 'Caja', activa: false },
      { agenciaId: PUTUMAYO, servicioId: CREDITO, nombre: 'Crédito', activa: true },
    ]);
    demanda.opcionesHistoricas.mockResolvedValue([
      { agenciaId: PUTUMAYO, servicioId: CAJA, colaboradorId: COLABORADOR },
      { agenciaId: SIN_DEPARTAMENTO, servicioId: CAJA, colaboradorId: ADMIN_AGENCIA.id },
    ]);
    catalogoFiltros.nombresColaboradores.mockResolvedValue([{ id: COLABORADOR, nombre: 'Colaborador anterior' }]);
    await expect(servicio.opciones(ADMIN_AGENCIA, RANGO, PUTUMAYO, CAJA)).resolves.toEqual({
      servicios: [{ id: CAJA, nombre: 'Caja' }, { id: CREDITO, nombre: 'Crédito' }],
      colaboradores: [{ id: COLABORADOR, nombre: 'Colaborador anterior', agenciaIds: [PUTUMAYO] }],
    });
    expect(demanda.opcionesHistoricas).toHaveBeenCalledWith(RANGO, [PUTUMAYO], CAJA);
    expect(catalogoFiltros.nombresColaboradores).toHaveBeenCalledWith([COLABORADOR]);
    await expect(servicio.opciones(ADMIN_AGENCIA, RANGO, SIN_DEPARTAMENTO)).rejects.toMatchObject({ codigo: 'FUERA_DE_AMBITO' });
    expect(demanda.opcionesHistoricas).toHaveBeenCalledTimes(1);
  });

  it('mantiene el alcance del servicio en el calendario y valida el ámbito histórico de un colaborador', async () => {
    const { servicio, demanda, catalogoFiltros } = armar();
    catalogoFiltros.ofertas.mockResolvedValue([{ agenciaId: PUTUMAYO, servicioId: CAJA, nombre: 'Caja', activa: false }]);
    demanda.opcionesHistoricas.mockResolvedValue([{ agenciaId: PUTUMAYO, servicioId: CAJA, colaboradorId: COLABORADOR }]);
    const filtros = { servicioId: CAJA, colaboradorId: COLABORADOR };
    await servicio.tablero(SUPERADMIN, '2026-11', undefined, undefined, filtros);
    expect(demanda.tablero).toHaveBeenCalledWith('2026-11', [expect.objectContaining({
      agenciaId: PUTUMAYO, servicioActivo: false,
    })], null, filtros);
    await servicio.calendario(ADMIN_AGENCIA, PUTUMAYO, '2026-11', undefined, CAJA);
    expect(demanda.calendario).toHaveBeenCalledWith(PUTUMAYO, '2026-11', expect.objectContaining({ servicioId: CAJA, servicioActivo: false }));
    await expect(servicio.tablero(ADMIN_AGENCIA, '2026-11', PUTUMAYO, undefined, {
      ...filtros, colaboradorId: ADMIN_AGENCIA.id,
    })).rejects.toMatchObject({ codigo: 'COLABORADOR_NO_ENCONTRADO' });
  });

  it('rechaza y audita una consulta o escritura fuera de ámbito antes de consultar el catálogo', async () => {
    const { servicio, catalogo, demanda, auditoria } = armar();
    await expect(servicio.calendario(ADMIN_AGENCIA, SIN_DEPARTAMENTO, '2026-11')).rejects.toMatchObject({ codigo: 'FUERA_DE_AMBITO' });
    await expect(servicio.eliminarEvento(ADMIN_AGENCIA, SIN_DEPARTAMENTO, EVENTO.id)).rejects.toMatchObject({ codigo: 'FUERA_DE_AMBITO' });
    expect(catalogo.listarAgencias).not.toHaveBeenCalled();
    expect(demanda.eliminarEvento).not.toHaveBeenCalled();
    expect(auditoria.registrar).toHaveBeenNthCalledWith(2, expect.objectContaining({
      accion: 'INTENTO_FUERA_DE_AMBITO', ambito: SIN_DEPARTAMENTO, detalle: { accion: 'EVENTO_AGENCIA_ELIMINADO' },
    }));
  });

  it('audita los cambios de eventos y rechaza una edición sin campos', async () => {
    const { servicio, demanda, auditoria } = armar();
    const { fecha, tipo } = EVENTO;
    await servicio.crearEvento(ADMIN_AGENCIA, PUTUMAYO, { fecha, tipo });
    await servicio.editarEvento(ADMIN_AGENCIA, PUTUMAYO, EVENTO.id, { tipo: 'FESTIVO_LOCAL' });
    await servicio.eliminarEvento(ADMIN_AGENCIA, PUTUMAYO, EVENTO.id);
    await expect(servicio.editarEvento(ADMIN_AGENCIA, PUTUMAYO, EVENTO.id, {})).rejects.toMatchObject({ codigo: 'EVENTO_AGENCIA_SIN_CAMBIOS' });
    expect(demanda.editarEvento).toHaveBeenCalledTimes(1);
    expect(auditoria.registrar.mock.calls.map(([entrada]) => entrada.accion)).toEqual([
      'EVENTO_AGENCIA_CREADO', 'EVENTO_AGENCIA_EDITADO', 'EVENTO_AGENCIA_ELIMINADO',
    ]);
  });

  it('usa fechas civiles y valida entradas públicas sin localización de parte del cliente', async () => {
    await expect(validate(plainToInstance(MesDemandaDto, { mes: '2026-13' }))).resolves.toHaveLength(1);
    await expect(validate(plainToInstance(MesDemandaDto, { mes: '2026-11', departamento: 'PUTUMAYO' }), {
      whitelist: true, forbidNonWhitelisted: true,
    })).resolves.toHaveLength(1);
    await expect(validate(plainToInstance(DatosEventoAgenciaDto, { fecha: '2026-02-29', tipo: 'PAGO_NOMINA' }))).resolves.toHaveLength(1);
    await expect(validate(plainToInstance(CambiosEventoAgenciaDto, { fecha: null }))).resolves.toHaveLength(1);
    await expect(validate(plainToInstance(CambiosEventoAgenciaDto, { fecha: '2028-02-29' }))).resolves.toHaveLength(0);
  });
});

describe('Integración con FastAPI para demanda', () => {
  afterEach(() => jest.restoreAllMocks());

  it('envía la ubicación validada, el cierre de la agencia y el token por el cliente de servicio', async () => {
    const fetch = jest.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(CALENDARIO));
    const adaptador = new AnaliticaHttpAdapter();
    await expect(adaptador.calendario(PUTUMAYO, '2026-11', {
      departamento: 'PUTUMAYO', municipio: 'Puerto Asís', activa: false,
    })).resolves.toEqual(CALENDARIO);
    expect(fetch).toHaveBeenCalledWith(
      `${leerConfig().analiticaUrl}/api/v1/analitica/agencias/${PUTUMAYO}/demanda?mes=2026-11&departamento=PUTUMAYO&municipio=Puerto+As%C3%ADs&activa=false`,
      expect.objectContaining({ method: 'GET', headers: expect.objectContaining({ 'X-Service-Token': leerConfig().serviceToken }) }),
    );
  });

  it('traduce el conflicto y el evento inexistente sin repetir escrituras', async () => {
    const fetch = jest.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 409 }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }));
    const adaptador = new AnaliticaHttpAdapter();
    await expect(adaptador.crearEvento(PUTUMAYO, { fecha: EVENTO.fecha, tipo: EVENTO.tipo })).rejects.toMatchObject({
      codigo: 'EVENTO_AGENCIA_DUPLICADO',
    });
    await expect(adaptador.eliminarEvento(PUTUMAYO, EVENTO.id)).rejects.toMatchObject({ codigo: 'EVENTO_AGENCIA_NO_ENCONTRADO' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('envía los filtros y la búsqueda de actividad histórica al servicio interno', async () => {
    const actividad = [{ agenciaId: PUTUMAYO, servicioId: CAJA, colaboradorId: COLABORADOR }];
    const fetch = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json({ opciones: actividad }))
      .mockResolvedValueOnce(Response.json({ atendidos: 5 }));
    const adaptador = new AnaliticaHttpAdapter();
    await expect(adaptador.opcionesHistoricas(RANGO, [PUTUMAYO], CAJA)).resolves.toEqual(actividad);
    await adaptador.indicadores(PUTUMAYO, RANGO.desde, RANGO.hasta, { servicioId: CAJA, colaboradorId: COLABORADOR });
    expect(fetch).toHaveBeenNthCalledWith(1, `${leerConfig().analiticaUrl}/api/v1/analitica/filtros`, expect.objectContaining({
      method: 'POST', body: JSON.stringify({ ...RANGO, agenciaIds: [PUTUMAYO], servicioId: CAJA }),
    }));
    expect(fetch).toHaveBeenNthCalledWith(2, expect.stringContaining(`servicioId=${CAJA}&colaboradorId=${COLABORADOR}`), expect.anything());
  });
});
