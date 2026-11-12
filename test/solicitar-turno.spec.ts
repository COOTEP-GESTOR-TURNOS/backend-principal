import { ServicioNoDisponibleError } from '../src/compartido/application/errores-aplicacion';
import { ConflictoError, NoEncontradoError, ReglaNegocioError } from '../src/compartido/domain/errores';
import { EstadoTurno } from '../src/turnos/domain/estado-turno';
import { armarEscenario, comando } from './armar-escenario';

describe('Caso de uso SolicitarTurno con adaptadores en memoria', () => {
  it('PR-03: crea el turno, lo encola, publica sus eventos y avisa a la fila', async () => {
    const e = armarEscenario();
    const resumen = await e.solicitar.ejecutar(comando('joven', 'k1'));

    expect(resumen.codigo).toBe('C-001');
    expect(resumen.estado).toBe(EstadoTurno.PROXIMO); // nadie delante y N_PROXIMO = 3
    expect(resumen.tipoAtencion).toBe('GENERAL');
    expect(e.eventos.eventos.map((ev) => ev.tipo)).toEqual(['TurnoSolicitado', 'TurnoEnEspera', 'TurnoProximo']);
    expect(e.notificador.filas).toHaveLength(1);
  });

  it('PR-04: un segundo turno activo del mismo asociado devuelve conflicto (RN-01)', async () => {
    const e = armarEscenario();
    await e.solicitar.ejecutar(comando('joven', 'k1'));
    const error = await e.solicitar.ejecutar(comando('joven', 'k2')).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(ConflictoError);
    expect((error as ConflictoError).codigo).toBe('TURNO_ACTIVO');
  });

  it('la misma Idempotency-Key devuelve el mismo turno sin encolar otro', async () => {
    const e = armarEscenario();
    const primero = await e.solicitar.ejecutar(comando('joven', 'k1'));
    const repetido = await e.solicitar.ejecutar(comando('joven', 'k1'));
    expect(repetido.id).toBe(primero.id);
    expect(await e.motor.personasDelante(`${primero.agenciaId}:${primero.servicioId}`, primero.id, 2)).toBe(0);
  });

  it('un adulto mayor queda en la fila preferencial (RN-05)', async () => {
    const e = armarEscenario();
    const resumen = await e.solicitar.ejecutar(comando('mayor', 'k1'));
    expect(resumen.tipoAtencion).toBe('PREFERENCIAL');
  });

  it('rechaza turnos fuera del horario de atención (RN-03)', async () => {
    const e = armarEscenario(new Date('2026-11-20T23:00:00Z')); // 18:00 en Mocoa
    await expect(e.solicitar.ejecutar(comando('joven', 'k1'))).rejects.toBeInstanceOf(ReglaNegocioError);
  });

  it('si el motor de filas falla, cancela el turno y permite pedir otro', async () => {
    const e = armarEscenario();
    e.motor.fallarAlEncolar = true;
    await expect(e.solicitar.ejecutar(comando('joven', 'k1'))).rejects.toBeInstanceOf(ServicioNoDisponibleError);

    e.motor.fallarAlEncolar = false;
    const resumen = await e.solicitar.ejecutar(comando('joven', 'k2'));
    expect(resumen.estado).toBe(EstadoTurno.PROXIMO);
  });

  it('un asociado no puede cancelar el turno de otro (RN-14)', async () => {
    const e = armarEscenario();
    const ajeno = await e.solicitar.ejecutar(comando('joven', 'k1'));
    await expect(
      e.cancelar.ejecutar({ turnoId: ajeno.id, solicitante: { id: 'mayor', roles: [{ rol: 'ASOCIADO' }] } }),
    ).rejects.toBeInstanceOf(NoEncontradoError);
  });
});
