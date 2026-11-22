import { CerrarAgenciaService } from '../src/administracion/application/use-cases/cerrar-agencia.service';
import { AgenciasEnMemoria } from '../src/administracion/infrastructure/out/memoria/agencias-en-memoria';
import { ConflictoError } from '../src/compartido/domain/errores';
import type { Principal } from '../src/compartido/domain/principal';
import { AuditoriaEnMemoria } from '../src/identidad/infrastructure/out/memoria/adaptadores-en-memoria';
import { AtenderTurnoService } from '../src/turnos/application/use-cases/atender-turno.service';
import { RevisarVencimientosService } from '../src/turnos/application/use-cases/revisar-vencimientos.service';
import { EstadoTurno } from '../src/turnos/domain/estado-turno';
import { CerrojoEnMemoria, JornadasEnMemoria } from '../src/turnos/infrastructure/out/memoria/adaptadores-en-memoria';
import { AGENCIA, armarEscenario, comando, SERVICIO } from './armar-escenario';

const funcionario: Principal = { id: 'f1', roles: [{ rol: 'FUNCIONARIO', agenciaId: AGENCIA }] };
const companero: Principal = { id: 'f2', roles: [{ rol: 'FUNCIONARIO', agenciaId: AGENCIA }] };
const FILA = `${AGENCIA}:${SERVICIO}`;
const MINUTOS_DIA = 24 * 60;

/** Viernes 20 de noviembre de 2026, 09:00 en Mocoa (atiende de 08:00 a 16:00). */
function armar(instante?: Date) {
  const e = armarEscenario(instante);
  const cerrojo = new CerrojoEnMemoria();
  const jornadas = new JornadasEnMemoria();
  const auditoria = new AuditoriaEnMemoria();
  const agencias = new AgenciasEnMemoria([
    {
      id: AGENCIA,
      codigo: 'MOC',
      nombre: 'Agencia Mocoa',
      municipio: 'Mocoa',
      activa: true,
      servicios: [{ servicioId: SERVICIO, codigo: 'CAJA', nombre: 'Caja', prefijo: 'C', ventanillas: 2, activo: true }],
      parametros: {},
    },
  ]);
  return {
    ...e,
    cerrojo,
    jornadas,
    auditoria,
    revisar: new RevisarVencimientosService(e.turnos, e.catalogo, e.motor, e.eventos, e.notificador, e.ids, e.reloj, cerrojo),
    cerrar: new CerrarAgenciaService(agencias, e.turnos, e.motor, e.catalogo, e.eventos, e.notificador, e.ids, e.reloj, cerrojo, auditoria, jornadas),
    atender: new AtenderTurnoService(e.turnos, e.motor, e.eventos, e.notificador, e.ids, e.reloj),
    llamarUno: (quien = funcionario) => e.llamar.ejecutar({ agenciaId: AGENCIA, servicioId: SERVICIO, funcionario: quien }),
  };
}

async function enAtencion(e: ReturnType<typeof armar>) {
  await e.solicitar.ejecutar(comando('joven', 'k1'));
  const turno = (await e.llamarUno())!;
  await e.atender.ejecutar({ turnoId: turno.id, accion: 'INICIAR', funcionario });
  return turno;
}

describe('RN-13: ningún turno sobrevive a su jornada', () => {
  it('los pendientes de días anteriores se cancelan por cierre, aunque la agencia siga abierta hoy', async () => {
    const e = armar();
    const turno = await e.solicitar.ejecutar(comando('joven', 'k1'));
    e.reloj.avanzar(3 * MINUTOS_DIA); // lunes 09:00: el backend estuvo apagado

    // No es una ausencia: el asociado no tuvo la culpa.
    expect((await e.revisar.ejecutar()).sinConfirmar).toBe(0);
    const cierres = await e.cerrar.cierreAutomatico();

    expect(cierres).toMatchObject([{ fecha: '2026-11-20', cancelados: 1, automatico: true }]);
    expect((await e.turnos.obtener(turno.id))?.instantanea()).toMatchObject({ estado: 'CANCELADO', motivo: 'CIERRE_AGENCIA' });
    expect(await e.motor.personasDelante(FILA, turno.id, 2)).toBeNull();
    expect(e.auditoria.entradas.at(-1)).toMatchObject({ accion: 'JORNADA_CERRADA', detalle: { fecha: '2026-11-20', cancelados: 1 } });
    expect((await e.solicitar.ejecutar(comando('joven', 'k2'))).estado).toBe(EstadoTurno.PROXIMO); // RN-01 libre
    expect(await e.cerrar.cierreAutomatico()).toEqual([]); // y hoy no se cierra
  });

  it('un turno confirmado de un día anterior también se cancela', async () => {
    const e = armar();
    const solicitado = await e.solicitar.ejecutar(comando('joven', 'k1'));
    const turno = (await e.turnos.obtener(solicitado.id))!;
    turno.confirmarPresencia(e.reloj.ahora());
    await e.turnos.actualizar(turno);
    e.reloj.avanzar(MINUTOS_DIA);

    await e.cerrar.cierreAutomatico();
    expect((await e.turnos.obtener(solicitado.id))?.estado).toBe(EstadoTurno.CANCELADO);
  });

  it('si la base falla al cancelar, el siguiente ciclo lo reintenta', async () => {
    const e = armar();
    const turno = await e.solicitar.ejecutar(comando('joven', 'k1'));
    e.reloj.avanzar(7 * 60 + 1); // 16:01
    const original = e.turnos.actualizar.bind(e.turnos);
    e.turnos.actualizar = async () => {
      throw new Error('PostgreSQL no respondió');
    };
    expect(await e.cerrar.cierreAutomatico()).toMatchObject([{ cancelados: 0 }]);

    e.turnos.actualizar = original;
    e.reloj.avanzar(1);
    expect(await e.cerrar.cierreAutomatico()).toMatchObject([{ cancelados: 1 }]);
    expect((await e.turnos.obtener(turno.id))?.estado).toBe(EstadoTurno.CANCELADO);
  });

  it('si el proceso murió con la jornada ya marcada, el siguiente ciclo termina el cierre', async () => {
    const e = armar();
    const turno = await e.solicitar.ejecutar(comando('joven', 'k1'));
    await e.jornadas.cerrar(AGENCIA, '2026-11-20');

    expect(await e.cerrar.cierreAutomatico()).toMatchObject([{ cancelados: 1 }]);
    expect((await e.turnos.obtener(turno.id))?.estado).toBe(EstadoTurno.CANCELADO);
    expect(await e.motor.personasDelante(FILA, turno.id, 2)).toBeNull();
  });

  it('el cerrojo del cierre vence pronto: si el proceso murió antes de marcar la jornada, se reintenta', async () => {
    const e = armar();
    const tomar = jest.spyOn(e.cerrojo, 'tomar');
    e.reloj.avanzar(7 * 60 + 1);
    await e.cerrar.cierreAutomatico();
    const [, ttl] = tomar.mock.calls[0] as unknown as [string, number];
    expect(ttl).toBeLessThanOrEqual(5 * 60);
  });

  it('si el motor no responde, un rezagado no se cancela todavía', async () => {
    const e = armar();
    const turno = await e.solicitar.ejecutar(comando('joven', 'k1'));
    e.reloj.avanzar(MINUTOS_DIA);
    const retirar = jest.spyOn(e.motor, 'retirar').mockRejectedValueOnce(new Error('Motor caído'));

    expect(await e.cerrar.cierreAutomatico()).toEqual([]);
    expect((await e.turnos.obtener(turno.id))?.estado).toBe(EstadoTurno.PROXIMO);
    retirar.mockRestore();
    expect(await e.cerrar.cierreAutomatico()).toMatchObject([{ cancelados: 1 }]);
  });

  it('RN-11: un Llamado de un día anterior vence igual', async () => {
    const e = armar();
    await e.solicitar.ejecutar(comando('joven', 'k1'));
    const turno = (await e.llamarUno())!;
    e.reloj.avanzar(MINUTOS_DIA);

    expect((await e.revisar.ejecutar()).noSePresento).toBe(1);
    expect((await e.turnos.obtener(turno.id))?.motivo).toBe('NO_SE_PRESENTO');
  });
});

describe('RN-13: una atención olvidada se cierra sola', () => {
  it('60 minutos después del cierre queda Atendido con motivo CIERRE_AUTOMATICO', async () => {
    const e = armar();
    const turno = await enAtencion(e);

    e.reloj.avanzar(7 * 60 + 59); // 16:59
    await e.revisar.ejecutar();
    expect((await e.turnos.obtener(turno.id))?.estado).toBe(EstadoTurno.EN_ATENCION);

    e.reloj.avanzar(1); // 17:00
    expect(await e.revisar.ejecutar()).toMatchObject({ atencionesCerradas: 1 });
    expect((await e.turnos.obtener(turno.id))?.instantanea()).toMatchObject({ estado: 'ATENDIDO', motivo: 'CIERRE_AUTOMATICO' });
    // El tipo propio le dice a la analítica que esa duración no es una atención real.
    expect(e.eventos.eventos.at(-1)).toMatchObject({ tipo: 'TurnoCerradoPorSistema', estadoNuevo: 'ATENDIDO', actorId: null });
    expect(await e.turnos.buscarActivoDeAsociado('joven')).toBeNull();
  });

  it('si la atención empezó después del cierre, el margen cuenta desde que empezó', async () => {
    const e = armar(new Date('2026-11-20T20:59:00Z')); // 15:59
    await e.solicitar.ejecutar(comando('joven', 'k1'));
    const turno = (await e.llamarUno())!;
    e.reloj.avanzar(2); // 16:01
    await e.atender.ejecutar({ turnoId: turno.id, accion: 'INICIAR', funcionario });

    e.reloj.avanzar(59); // 17:00
    await e.revisar.ejecutar();
    expect((await e.turnos.obtener(turno.id))?.estado).toBe(EstadoTurno.EN_ATENCION);
    e.reloj.avanzar(1); // 17:01
    await e.revisar.ejecutar();
    expect((await e.turnos.obtener(turno.id))?.estado).toBe(EstadoTurno.ATENDIDO);
  });

  it('una atención de un día anterior se cierra al primer ciclo', async () => {
    const e = armar();
    const turno = await enAtencion(e);
    e.reloj.avanzar(3 * MINUTOS_DIA);
    await e.revisar.ejecutar();
    expect((await e.turnos.obtener(turno.id))?.estado).toBe(EstadoTurno.ATENDIDO);
  });
});

describe('CU-04: un turno en ventanilla por funcionario', () => {
  it('no llama otro sin terminar el actual, y el que esperaba sigue en la fila', async () => {
    const e = armar();
    const actual = await enAtencion(e);
    const siguiente = await e.solicitar.ejecutar(comando('otro', 'k2'));

    await expect(e.llamarUno()).rejects.toMatchObject({ codigo: 'TURNO_EN_VENTANILLA' });
    expect(await e.motor.personasDelante(FILA, siguiente.id, 2)).toBe(0);

    await e.atender.ejecutar({ turnoId: actual.id, accion: 'FINALIZAR', funcionario });
    expect((await e.llamarUno())?.id).toBe(siguiente.id);
  });

  it('otro funcionario de la misma fila sí puede llamar', async () => {
    const e = armar();
    await enAtencion(e);
    const siguiente = await e.solicitar.ejecutar(comando('otro', 'k2'));
    expect((await e.llamarUno(companero))?.id).toBe(siguiente.id);
  });

  it('dos pulsaciones a la vez llaman un solo turno', async () => {
    const e = armar();
    await e.solicitar.ejecutar(comando('joven', 'k1'));
    await e.solicitar.ejecutar(comando('otro', 'k2'));
    const resultados = await Promise.allSettled([e.llamarUno(), e.llamarUno()]);
    expect(resultados.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
  });

  it('si el turno cambia justo al llamarlo, se relee y no queda fuera de la fila sin llamar', async () => {
    const e = armar();
    const turno = await e.solicitar.ejecutar(comando('joven', 'k1'));
    jest.spyOn(e.turnos, 'actualizar').mockRejectedValueOnce(new ConflictoError('TURNO_MODIFICADO', 'confirmó en ese instante'));
    expect((await e.llamarUno())?.id).toBe(turno.id);
    expect((await e.turnos.obtener(turno.id))?.estado).toBe(EstadoTurno.LLAMADO);
  });
});
