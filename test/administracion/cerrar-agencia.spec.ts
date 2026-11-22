import { CerrarAgenciaService } from '../../src/administracion/application/use-cases/cerrar-agencia.service';
import { GestionarAgenciasService } from '../../src/administracion/application/use-cases/gestionar-agencias.service';
import { AgenciasEnMemoria, InvalidadorEnMemoria } from '../../src/administracion/infrastructure/out/memoria/agencias-en-memoria';
import { ServicioNoDisponibleError } from '../../src/compartido/application/errores-aplicacion';
import { PermisoDenegadoError } from '../../src/compartido/domain/errores';
import type { Principal } from '../../src/compartido/domain/principal';
import { AuditoriaEnMemoria } from '../../src/identidad/infrastructure/out/memoria/adaptadores-en-memoria';
import { LlamarSiguienteService } from '../../src/turnos/application/use-cases/llamar-siguiente.service';
import { SolicitarTurnoService } from '../../src/turnos/application/use-cases/solicitar-turno.service';
import { EstadoTurno } from '../../src/turnos/domain/estado-turno';
import { Fila } from '../../src/turnos/domain/fila';
import {
  CatalogoEnMemoria,
  CerrojoEnMemoria,
  EventStoreEnMemoria,
  GeneradorIdsSecuencial,
  JornadasEnMemoria,
  MotorFilasEnMemoria,
  NotificadorEnMemoria,
  PerfilAsociadoEnMemoria,
  RelojFijo,
  TurnoRepositoryEnMemoria,
} from '../../src/turnos/infrastructure/out/memoria/adaptadores-en-memoria';

const MOCOA = 'a0000000-0000-4000-8000-000000000001';
const ORITO = 'a0000000-0000-4000-8000-000000000003';
const CAJA = 'b0000000-0000-4000-8000-000000000001';

const superadmin: Principal = { id: 's', roles: [{ rol: 'SUPERADMIN' }] };
const directivoMocoa: Principal = { id: 'd', roles: [{ rol: 'ADMIN_AGENCIA', agenciaId: MOCOA }] };
const funcionario: Principal = { id: 'f', roles: [{ rol: 'FUNCIONARIO', agenciaId: MOCOA }] };

const fila = (agencia: string) =>
  new Fila(agencia, CAJA, 'C', 2, { apertura: '08:00', cierre: '16:00' }, { nProximo: 3, maxPreferencialesSeguidos: 2, edadAdultoMayor: 60 }, true);
const config = (id: string, nombre: string) => ({
  id,
  codigo: nombre.slice(0, 4),
  nombre,
  municipio: nombre,
  activa: true,
  servicios: [{ servicioId: CAJA, codigo: 'CAJA', nombre: 'Caja', prefijo: 'C', ventanillas: 2, activo: true }],
  parametros: {},
});

/** Mocoa con 4 turnos (uno ya llamado) y Orito con 1, a las 09:00 en Colombia. */
async function armar() {
  const turnos = new TurnoRepositoryEnMemoria();
  const catalogo = new CatalogoEnMemoria([fila(MOCOA), fila(ORITO)]);
  const motor = new MotorFilasEnMemoria();
  const eventos = new EventStoreEnMemoria();
  const notificador = new NotificadorEnMemoria();
  const ids = new GeneradorIdsSecuencial();
  const reloj = new RelojFijo(new Date('2026-11-20T14:00:00Z'));
  const auditoria = new AuditoriaEnMemoria();
  const jornadas = new JornadasEnMemoria();
  const agencias = new AgenciasEnMemoria([config(MOCOA, 'Agencia Mocoa'), config(ORITO, 'Agencia Orito')]);
  const solicitar = new SolicitarTurnoService(turnos, catalogo, new PerfilAsociadoEnMemoria(), motor, eventos, notificador, ids, reloj, jornadas);
  const llamar = new LlamarSiguienteService(turnos, catalogo, motor, eventos, notificador, ids, reloj, new CerrojoEnMemoria());
  const cerrar = new CerrarAgenciaService(agencias, turnos, motor, catalogo, eventos, notificador, ids, reloj, new CerrojoEnMemoria(), auditoria, jornadas);

  const pedir = (asociadoId: string, agenciaId: string, clave = `k-${asociadoId}`) =>
    solicitar.ejecutar({ asociadoId, agenciaId, servicioId: CAJA, solicitaPreferencial: false, canal: 'WEB', idempotencyKey: clave });
  for (const quien of ['a', 'b', 'c', 'd']) await pedir(quien, MOCOA);
  const enOrito = await pedir('e', ORITO);
  await llamar.ejecutar({ agenciaId: MOCOA, servicioId: CAJA, funcionario }); // 'a' queda LLAMADO
  return { turnos, motor, notificador, reloj, auditoria, agencias, cerrar, enOrito, pedir };
}

describe('RN-13: cierre de la jornada de una agencia', () => {
  it('cancela los pendientes con motivo cierre, vacía el motor y avisa a cada asociado; el llamado sigue', async () => {
    const e = await armar();
    const r = await e.cerrar.cerrarJornada(directivoMocoa, MOCOA, '10.0.0.1');

    expect(r).toMatchObject({ cancelados: 3, retiradosDelMotor: 3, siguenEnAtencion: 1, automatico: false });
    for (const quien of ['b', 'c', 'd']) {
      expect(await e.turnos.buscarActivoDeAsociado(quien)).toBeNull();
      // El último aviso de cada asociado es el de la cancelación (el primero fue el de la solicitud).
      const avisos = e.notificador.turnos.filter((n) => n.asociadoId === quien);
      expect(avisos.at(-1)?.resumen).toMatchObject({ estado: 'CANCELADO', motivo: 'CIERRE_AGENCIA' });
    }
    expect((await e.turnos.buscarActivoDeAsociado('a'))?.estado).toBe(EstadoTurno.LLAMADO);
    // Orito no se toca.
    expect((await e.turnos.obtener(e.enOrito.id))?.estado).not.toBe(EstadoTurno.CANCELADO);
    expect(e.auditoria.entradas.at(-1)).toMatchObject({ accion: 'JORNADA_CERRADA', ambito: MOCOA, detalle: { cancelados: 3 } });
  });

  it('cerrar dos veces no cambia nada la segunda vez', async () => {
    const e = await armar();
    await e.cerrar.cerrarJornada(superadmin, MOCOA);
    expect(await e.cerrar.cerrarJornada(superadmin, MOCOA)).toMatchObject({ cancelados: 0, retiradosDelMotor: 0 });
  });

  it('un directivo no cierra otra agencia y queda auditado', async () => {
    const e = await armar();
    await expect(e.cerrar.cerrarJornada(directivoMocoa, ORITO)).rejects.toBeInstanceOf(PermisoDenegadoError);
    expect(e.auditoria.acciones()).toEqual(['INTENTO_FUERA_DE_AMBITO']);
  });

  it('si el motor no responde no cancela nada (un turno cancelado no puede quedar en una cola)', async () => {
    const e = await armar();
    e.motor.caido = true;
    await expect(e.cerrar.cerrarJornada(superadmin, MOCOA)).rejects.toBeInstanceOf(ServicioNoDisponibleError);
    expect((await e.turnos.buscarActivoDeAsociado('b'))?.estado).not.toBe(EstadoTurno.CANCELADO);
    expect(await e.cerrar.jornadaCerrada(MOCOA)).toBe(false); // la agencia sigue recibiendo turnos
  });

  it('cerrada antes de la hora, la agencia no recibe turnos nuevos hoy; las demás sí', async () => {
    const e = await armar();
    await e.cerrar.cerrarJornada(directivoMocoa, MOCOA);
    expect(await e.cerrar.jornadaCerrada(MOCOA)).toBe(true);
    await expect(e.pedir('b', MOCOA, 'k-b-2')).rejects.toMatchObject({ codigo: 'JORNADA_CERRADA' });
    await expect(e.pedir('f', ORITO)).resolves.toMatchObject({ estado: expect.any(String) });
  });

  it('reabrir deshace el cierre anticipado y queda auditado; reabrir otra vez no hace nada', async () => {
    const e = await armar();
    await e.cerrar.cerrarJornada(directivoMocoa, MOCOA);
    expect(await e.cerrar.reabrirJornada(directivoMocoa, MOCOA)).toMatchObject({ reabierta: true });
    await expect(e.pedir('b', MOCOA, 'k-b-2')).resolves.toMatchObject({ agenciaId: MOCOA });
    expect(await e.cerrar.reabrirJornada(directivoMocoa, MOCOA)).toMatchObject({ reabierta: false });
    expect(e.auditoria.acciones().filter((a) => a === 'JORNADA_REABIERTA')).toHaveLength(1);
    await expect(e.cerrar.reabrirJornada(directivoMocoa, ORITO)).rejects.toBeInstanceOf(PermisoDenegadoError);
  });

  it('el cierre automático no repite el de una agencia que el directivo ya cerró hoy', async () => {
    const e = await armar();
    await e.cerrar.cerrarJornada(directivoMocoa, MOCOA);
    e.reloj.avanzar(7 * 60 + 1); // 16:01
    expect((await e.cerrar.cierreAutomatico()).map((c) => c.nombre)).toEqual(['Agencia Orito']);
  });

  it('el cierre automático corre a la hora de cierre de cada agencia, una sola vez por día', async () => {
    const e = await armar();
    expect(await e.cerrar.cierreAutomatico()).toEqual([]); // 09:00, aún abiertas
    e.reloj.avanzar(7 * 60 + 1); // 16:01
    const cierres = await e.cerrar.cierreAutomatico();
    expect(cierres.map((c) => [c.nombre, c.cancelados, c.automatico])).toEqual([
      ['Agencia Mocoa', 3, true],
      ['Agencia Orito', 1, true],
    ]);
    expect(e.auditoria.entradas.at(-1)).toMatchObject({ accion: 'JORNADA_CERRADA', actorRol: 'SISTEMA' });
    expect(await e.cerrar.cierreAutomatico()).toEqual([]);
  });

  it('desactivar una agencia desde la gestión también cierra su jornada', async () => {
    const e = await armar();
    const gestion = new GestionarAgenciasService(e.agencias, new InvalidadorEnMemoria(), e.auditoria, e.cerrar);
    await gestion.actualizarAgencia(superadmin, MOCOA, { activa: false });
    expect(await e.turnos.buscarActivoDeAsociado('b')).toBeNull();
    expect(e.auditoria.acciones()).toEqual(expect.arrayContaining(['AGENCIA_DESACTIVADA', 'JORNADA_CERRADA']));
    // Al activarla de nuevo el mismo día, vuelve a recibir turnos.
    const vista = await gestion.actualizarAgencia(superadmin, MOCOA, { activa: true });
    expect(vista).toMatchObject({ activa: true, jornadaCerrada: false });
    expect(e.auditoria.acciones()).toContain('JORNADA_REABIERTA');
  });
});
