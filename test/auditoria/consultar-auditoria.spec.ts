import { errors, types, type Client as ClienteCassandra } from 'cassandra-driver';
import type {
  AuditoriaLecturaPort,
  DirectorioUsuariosPort,
  OpcionesPagina,
  PaginaAuditoria,
  RegistroAuditoria,
} from '../../src/auditoria/application/ports/out/auditoria-lectura.port';
import { ConsultarAuditoriaService } from '../../src/auditoria/application/use-cases/consultar-auditoria.service';
import { AuditoriaLecturaCassandraAdapter } from '../../src/auditoria/infrastructure/out/auditoria-lectura-cassandra.adapter';
import { DatosInvalidosError, ServicioNoDisponibleError } from '../../src/compartido/application/errores-aplicacion';
import { NoEncontradoError, PermisoDenegadoError, ReglaNegocioError } from '../../src/compartido/domain/errores';
import type { Principal } from '../../src/compartido/domain/principal';
import { Fila } from '../../src/turnos/domain/fila';
import { CatalogoEnMemoria, RelojFijo } from '../../src/turnos/infrastructure/out/memoria/adaptadores-en-memoria';

const MOCOA = 'a0000000-0000-4000-8000-000000000001';
const ANA = '11111111-0000-4000-8000-000000000001';
const DESCONOCIDO = '00000000-0000-0000-0000-000000000000';

const registro = (accion: string, actorId: string, minuto: number): RegistroAuditoria => ({
  ocurridoEn: new Date(Date.UTC(2026, 10, 16, 14, minuto)),
  ambito: 'GLOBAL',
  actorId,
  actorRol: 'SUPERADMIN',
  accion,
  objetivoTipo: 'USUARIO',
  objetivoId: 'x',
  detalle: { rol: 'ADMIN_AGENCIA' },
  ip: '10.0.0.1',
});

class LecturaEnMemoria implements AuditoriaLecturaPort {
  pedidos: { tipo: string; clave: string; opciones: OpcionesPagina & { accion?: string } }[] = [];
  async porAmbitoDia(ambito: string, dia: string, opciones: OpcionesPagina & { accion?: string }): Promise<PaginaAuditoria> {
    this.pedidos.push({ tipo: 'ambito', clave: `${ambito}:${dia}`, opciones });
    return { registros: [registro('ROL_ASIGNADO', ANA, 5), registro('LOGIN_FALLIDO', DESCONOCIDO, 1)], siguiente: 'ab12' };
  }
  async porActorMes(actorId: string, mes: string, opciones: OpcionesPagina): Promise<PaginaAuditoria> {
    this.pedidos.push({ tipo: 'actor', clave: `${actorId}:${mes}`, opciones });
    return { registros: [registro('LOGIN_ADMIN', actorId, 0)], siguiente: null };
  }
}

const directorio: DirectorioUsuariosPort = {
  buscar: async (ids) => new Map(ids.filter((id) => id === ANA).map((id) => [id, { nombre: 'Ana Superadmin', email: 'ana@cootep.test' }])),
};

const superadmin: Principal = { id: ANA, roles: [{ rol: 'SUPERADMIN' }] };
const directivo: Principal = { id: 'd', roles: [{ rol: 'ADMIN_AGENCIA', agenciaId: MOCOA }] };

function armar() {
  const lectura = new LecturaEnMemoria();
  const fila = new Fila(MOCOA, 'b1', 'C', 3, { apertura: '08:00', cierre: '16:00' }, { nProximo: 3, maxPreferencialesSeguidos: 2, edadAdultoMayor: 60 }, true);
  // Lunes 16 de noviembre de 2026, 10:00 en Colombia.
  const servicio = new ConsultarAuditoriaService(lectura, directorio, new CatalogoEnMemoria([fila]), new RelojFijo(new Date('2026-11-16T15:00:00Z')));
  return { servicio, lectura };
}

describe('RF-20, CU-06: consulta de la auditoría', () => {
  it('el superadministrador ve el día de hoy con el nombre de quien actuó', async () => {
    const { servicio, lectura } = armar();
    const r = await servicio.porAmbitoDia(superadmin, { ambito: 'GLOBAL' });
    expect(r.dia).toBe('2026-11-16');
    expect(r.entradas.map((e) => e.accion)).toEqual(['ROL_ASIGNADO', 'LOGIN_FALLIDO']);
    expect(r.entradas[0].actor).toMatchObject({ nombre: 'Ana Superadmin', email: 'ana@cootep.test' });
    expect(r.entradas[1].actor.nombre).toBeNull(); // intento con un correo que no existe
    expect(r.siguiente).toBe('ab12');
    expect(r.limite).toBe(50);
    expect(lectura.pedidos[0]).toMatchObject({ clave: 'GLOBAL:2026-11-16', opciones: { limite: 50 } });
  });

  it('pasa el filtro de acción, la página siguiente y limita el tamaño a 200', async () => {
    const { servicio, lectura } = armar();
    const r = await servicio.porAmbitoDia(superadmin, { ambito: MOCOA, dia: '2026-11-15', accion: 'INTENTO_FUERA_DE_AMBITO', limite: 500, siguiente: 'ab12' });
    expect(r.limite).toBe(200);
    expect(lectura.pedidos[0]).toMatchObject({
      clave: `${MOCOA}:2026-11-15`,
      opciones: { limite: 200, siguiente: 'ab12', accion: 'INTENTO_FUERA_DE_AMBITO' },
    });
  });

  it('solo el superadministrador la consulta', async () => {
    const { servicio } = armar();
    await expect(servicio.porAmbitoDia(directivo, { ambito: MOCOA })).rejects.toBeInstanceOf(PermisoDenegadoError);
    await expect(servicio.porActorMes(directivo, { actorId: ANA })).rejects.toBeInstanceOf(PermisoDenegadoError);
  });

  it('rechaza días futuros, fechas mal escritas y agencias que no existen', async () => {
    const { servicio } = armar();
    await expect(servicio.porAmbitoDia(superadmin, { ambito: 'GLOBAL', dia: '2026-11-17' })).rejects.toBeInstanceOf(ReglaNegocioError);
    await expect(servicio.porAmbitoDia(superadmin, { ambito: 'GLOBAL', dia: '16/11/2026' })).rejects.toBeInstanceOf(ReglaNegocioError);
    await expect(servicio.porAmbitoDia(superadmin, { ambito: 'a0000000-0000-4000-8000-000000000099' })).rejects.toBeInstanceOf(NoEncontradoError);
  });

  it('por persona usa el mes actual y valida el formato', async () => {
    const { servicio, lectura } = armar();
    const r = await servicio.porActorMes(superadmin, { actorId: ANA, limite: 1 });
    expect(r.mes).toBe('2026-11');
    expect(r).toMatchObject({ limite: 1, siguiente: null });
    expect(lectura.pedidos[0].clave).toBe(`${ANA}:2026-11`);
    await expect(servicio.porActorMes(superadmin, { actorId: ANA, mes: '2026-13' })).rejects.toBeInstanceOf(ReglaNegocioError);
  });
});

describe('Paginación nativa de auditoría en Cassandra', () => {
  it('usa el cursor devuelto por Cassandra y termina cuando ya no hay cursor', async () => {
    const execute = jest.fn()
      .mockResolvedValueOnce({ rows: [], pageState: 'ab12' })
      .mockResolvedValueOnce({ rows: [], pageState: null });
    const lectura = new AuditoriaLecturaCassandraAdapter({ execute } as unknown as ClienteCassandra);

    const primera = await lectura.porAmbitoDia('GLOBAL', '2026-11-16', { limite: 1 });
    expect(primera.siguiente).toBe('ab12');
    expect(execute.mock.calls[0][2]).toEqual({ prepare: true, fetchSize: 1 });

    const ultima = await lectura.porAmbitoDia('GLOBAL', '2026-11-16', { limite: 1, siguiente: primera.siguiente! });
    expect(ultima.siguiente).toBeNull();
    expect(execute.mock.calls[1][2]).toEqual({ prepare: true, fetchSize: 1, pageState: 'ab12' });
  });

  it('traduce un cursor inválido sin tratar otros errores como fallas de entrada', async () => {
    const execute = jest.fn()
      .mockRejectedValueOnce(new errors.ResponseError(types.responseErrorCodes.protocolError, 'Invalid value for the paging state'))
      .mockRejectedValueOnce(new errors.OperationTimedOutError('Se agotó el tiempo de lectura'));
    const lectura = new AuditoriaLecturaCassandraAdapter({ execute } as unknown as ClienteCassandra);
    const opciones = { limite: 1, siguiente: 'ab12' };

    await expect(lectura.porActorMes(ANA, '2026-11', opciones)).rejects.toBeInstanceOf(DatosInvalidosError);
    await expect(lectura.porActorMes(ANA, '2026-11', opciones)).rejects.toBeInstanceOf(ServicioNoDisponibleError);
  });
});
