import { RevisarVencimientosService } from '../src/turnos/application/use-cases/revisar-vencimientos.service';
import { ConflictoError } from '../src/compartido/domain/errores';
import type { Principal } from '../src/compartido/domain/principal';
import { EstadoTurno } from '../src/turnos/domain/estado-turno';
import type { Turno } from '../src/turnos/domain/turno';
import { CerrojoEnMemoria } from '../src/turnos/infrastructure/out/memoria/adaptadores-en-memoria';
import { AGENCIA, armarEscenario, comando, SERVICIO } from './armar-escenario';

const funcionario: Principal = { id: 'f1', roles: [{ rol: 'FUNCIONARIO', agenciaId: AGENCIA }] };

/** Escenario de turnos + la revisión de vencimientos, a las 09:00 en Mocoa (T_CONFIRMACION 5, T_LLAMADO 3). */
function armar() {
  const e = armarEscenario();
  const cerrojo = new CerrojoEnMemoria();
  const revisar = new RevisarVencimientosService(e.turnos, e.catalogo, e.motor, e.eventos, e.notificador, e.ids, e.reloj, cerrojo);
  return { ...e, revisar, cerrojo };
}

describe('S1-06: vencimientos de turnos (RN-10, RN-11)', () => {
  it('RN-10: un turno Próximo sin confirmar queda ausente a los 5 minutos, sale de la fila y el asociado recibe el aviso', async () => {
    const e = armar();
    const turno = await e.solicitar.ejecutar(comando('joven', 'k1'));
    expect(turno.estado).toBe(EstadoTurno.PROXIMO); // nadie delante

    e.reloj.avanzar(4);
    expect((await e.revisar.ejecutar()).sinConfirmar).toBe(0);

    e.reloj.avanzar(1);
    const r = await e.revisar.ejecutar();
    expect(r).toMatchObject({ ejecutada: true, sinConfirmar: 1 });
    const guardado = await e.turnos.obtener(turno.id);
    expect(guardado?.estado).toBe(EstadoTurno.AUSENTE);
    expect(guardado?.motivo).toBe('SIN_CONFIRMAR');
    expect(await e.motor.personasDelante(`${AGENCIA}:${SERVICIO}`, turno.id, 2)).toBeNull();
    expect(e.notificador.turnos.at(-1)).toMatchObject({ asociadoId: 'joven', resumen: { estado: 'AUSENTE', motivo: 'SIN_CONFIRMAR' } });
    expect(e.eventos.eventos.at(-1)).toMatchObject({ tipo: 'TurnoAusente', actorId: null });
    // Liberó RN-01: puede pedir otro turno.
    expect((await e.solicitar.ejecutar(comando('joven', 'k2'))).estado).toBe(EstadoTurno.PROXIMO);
  });

  it('confirmar a tiempo detiene el plazo de confirmación', async () => {
    const e = armar();
    const solicitado = await e.solicitar.ejecutar(comando('joven', 'k1'));
    e.reloj.avanzar(2);
    const turno = (await e.turnos.obtener(solicitado.id))!;
    turno.confirmarPresencia(e.reloj.ahora());
    await e.turnos.actualizar(turno);

    e.reloj.avanzar(30);
    expect((await e.revisar.ejecutar()).sinConfirmar).toBe(0);
    expect((await e.turnos.obtener(solicitado.id))?.estado).toBe(EstadoTurno.PROXIMO);
  });

  it('RN-11: un turno llamado que no pasa a la ventanilla en 3 minutos queda ausente', async () => {
    const e = armar();
    await e.solicitar.ejecutar(comando('joven', 'k1'));
    const llamado = await e.llamar.ejecutar({ agenciaId: AGENCIA, servicioId: SERVICIO, funcionario });
    e.reloj.avanzar(2);
    expect((await e.revisar.ejecutar()).noSePresento).toBe(0);
    e.reloj.avanzar(1);
    expect((await e.revisar.ejecutar()).noSePresento).toBe(1);
    expect((await e.turnos.obtener(llamado!.id))?.motivo).toBe('NO_SE_PRESENTO');
  });

  it('cuando la fila avanza, el turno que queda con 3 personas delante pasa a Próximo y recibe el aviso', async () => {
    const e = armar();
    for (const [i, quien] of ['a', 'b', 'c', 'd', 'e'].entries()) await e.solicitar.ejecutar(comando(quien, `k${i}`));
    const quinto = (await e.turnos.buscarActivoDeAsociado('e'))!;
    expect(quinto.estado).toBe(EstadoTurno.EN_ESPERA); // 4 personas delante

    expect((await e.revisar.ejecutar()).proximos).toBe(0);
    await e.llamar.ejecutar({ agenciaId: AGENCIA, servicioId: SERVICIO, funcionario });
    const r = await e.revisar.ejecutar();
    expect(r.proximos).toBe(1);
    expect((await e.turnos.obtener(quinto.id))?.estado).toBe(EstadoTurno.PROXIMO);
    expect(e.notificador.turnos.at(-1)).toMatchObject({ asociadoId: 'e', resumen: { estado: 'PROXIMO', personasDelante: 3 } });
    expect(e.notificador.filas.at(-1)).toBe(`${AGENCIA}:${SERVICIO}`);
  });

  it('si otra instancia tiene el cerrojo, este ciclo no toca nada', async () => {
    const e = armar();
    await e.solicitar.ejecutar(comando('joven', 'k1'));
    e.reloj.avanzar(10);
    await e.cerrojo.tomar('vencimientos');
    expect(await e.revisar.ejecutar()).toMatchObject({ ejecutada: false, revisados: 0 });
    await e.cerrojo.soltar('vencimientos');
    expect((await e.revisar.ejecutar()).sinConfirmar).toBe(1);
  });

  it('si el asociado confirma en el mismo instante, gana su acción y el turno sigue en la fila', async () => {
    const e = armar();
    const solicitado = await e.solicitar.ejecutar(comando('joven', 'k1'));
    e.reloj.avanzar(6);
    // Simula la carrera: entre la lectura de la revisión y su escritura, el asociado guarda primero.
    const original = e.turnos.actualizar.bind(e.turnos);
    e.turnos.actualizar = async (t: Turno) => {
      e.turnos.actualizar = original;
      throw new ConflictoError('TURNO_MODIFICADO', 'El turno cambió mientras se procesaba');
    };
    const r = await e.revisar.ejecutar();
    expect(r).toMatchObject({ conflictos: 1, sinConfirmar: 0 });
    // Como se guarda antes de retirarlo del motor, el turno no salió de la fila.
    expect(await e.motor.personasDelante(`${AGENCIA}:${SERVICIO}`, solicitado.id, 2)).toBe(0);
  });
});
