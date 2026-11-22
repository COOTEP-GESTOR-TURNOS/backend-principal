import { ConflictoError } from '../src/compartido/domain/errores';
import type { Principal } from '../src/compartido/domain/principal';
import { AtenderTurnoService } from '../src/turnos/application/use-cases/atender-turno.service';
import { RevisarVencimientosService } from '../src/turnos/application/use-cases/revisar-vencimientos.service';
import { EstadoTurno } from '../src/turnos/domain/estado-turno';
import type { Turno } from '../src/turnos/domain/turno';
import { CerrojoEnMemoria } from '../src/turnos/infrastructure/out/memoria/adaptadores-en-memoria';
import { AGENCIA, armarEscenario, comando, SERVICIO } from './armar-escenario';

const funcionario: Principal = { id: 'f1', roles: [{ rol: 'FUNCIONARIO', agenciaId: AGENCIA }] };
const companero: Principal = { id: 'f2', roles: [{ rol: 'FUNCIONARIO', agenciaId: AGENCIA }] };
const asociado = (id: string): Principal => ({ id, roles: [{ rol: 'ASOCIADO' }] });
const FILA = `${AGENCIA}:${SERVICIO}`;
const PENDIENTES: EstadoTurno[] = [EstadoTurno.SOLICITADO, EstadoTurno.EN_ESPERA, EstadoTurno.PROXIMO];

function armar() {
  const e = armarEscenario();
  return {
    ...e,
    atender: new AtenderTurnoService(e.turnos, e.motor, e.eventos, e.notificador, e.ids, e.reloj),
    llamarUno: (quien = funcionario) => e.llamar.ejecutar({ agenciaId: AGENCIA, servicioId: SERVICIO, funcionario: quien }),
    enFila: async (id: string) => (await e.motor.personasDelante(FILA, id, 2)) !== null,
    solicitudes: (id: string) => e.eventos.eventos.filter((v) => v.turnoId === id && v.tipo === 'TurnoSolicitado'),
  };
}

describe('La base y la fila no se separan cuando dos acciones coinciden', () => {
  it('cancelar justo cuando el turno cambia: se relee y queda cancelado y fuera de la fila', async () => {
    const e = armar();
    const turno = await e.solicitar.ejecutar(comando('joven', 'k1'));
    jest.spyOn(e.turnos, 'actualizar').mockRejectedValueOnce(new ConflictoError('TURNO_MODIFICADO', 'pasó a Próximo'));

    expect((await e.cancelar.ejecutar({ turnoId: turno.id, solicitante: asociado('joven') })).estado).toBe(EstadoTurno.CANCELADO);
    expect(await e.enFila(turno.id)).toBe(false);
  });

  it('si la base falla al cancelar, el turno conserva su puesto', async () => {
    const e = armar();
    const turno = await e.solicitar.ejecutar(comando('joven', 'k1'));
    jest.spyOn(e.turnos, 'actualizar').mockRejectedValueOnce(new Error('PostgreSQL no respondió'));

    await expect(e.cancelar.ejecutar({ turnoId: turno.id, solicitante: asociado('joven') })).rejects.toThrow('PostgreSQL');
    expect(await e.enFila(turno.id)).toBe(true);
  });

  it('cancelar justo cuando lo llaman: gana el llamado', async () => {
    const e = armar();
    const turno = await e.solicitar.ejecutar(comando('joven', 'k1'));
    const real = e.turnos.actualizar.bind(e.turnos);
    e.turnos.actualizar = async (t: Turno) => {
      e.turnos.actualizar = real;
      await e.llamarUno();
      return real(t);
    };

    await expect(e.cancelar.ejecutar({ turnoId: turno.id, solicitante: asociado('joven') })).rejects.toMatchObject({ codigo: 'TRANSICION_INVALIDA' });
    expect((await e.turnos.obtener(turno.id))?.estado).toBe(EstadoTurno.LLAMADO);
  });

  it('llamar mientras el turno entra a la fila: queda llamado con su número y un solo evento de solicitud', async () => {
    const e = armar();
    const real = e.motor.encolar.bind(e.motor);
    e.motor.encolar = async (...datos) => {
      const encolado = await real(...datos);
      await e.llamarUno();
      return encolado;
    };

    const turno = await e.solicitar.ejecutar(comando('joven', 'k1'));
    expect(turno).toMatchObject({ estado: 'LLAMADO', codigo: 'C-001' });
    expect((await e.turnos.obtener(turno.id))?.numero).toBe(1);
    expect(e.solicitudes(turno.id)).toHaveLength(1);
  });

  it('cancelar mientras el turno entra a la fila: no queda en la fila', async () => {
    const e = armar();
    const real = e.motor.encolar.bind(e.motor);
    e.motor.encolar = async (...datos) => {
      await e.cancelar.ejecutar({ turnoId: datos[1], solicitante: asociado('joven') });
      return real(...datos);
    };

    const turno = await e.solicitar.ejecutar(comando('joven', 'k1'));
    expect(turno.estado).toBe(EstadoTurno.CANCELADO);
    expect(await e.enFila(turno.id)).toBe(false);
    expect(e.solicitudes(turno.id)).toHaveLength(1);
  });

  it('si el motor entrega un turno que ya terminó, lo salta y llama al siguiente', async () => {
    const e = armar();
    const terminado = await e.solicitar.ejecutar(comando('joven', 'k1'));
    const siguiente = await e.solicitar.ejecutar(comando('otro', 'k2'));
    const turno = (await e.turnos.obtener(terminado.id))!;
    turno.cancelar('CANCELADO_POR_ASOCIADO', 'joven', e.reloj.ahora());
    await e.turnos.actualizar(turno); // terminó, pero el motor no alcanzó a retirarlo

    expect((await e.llamarUno())?.id).toBe(siguiente.id);
  });

  it('si la base falla al llamar, el turno vuelve a su puesto', async () => {
    const e = armar();
    const primero = await e.solicitar.ejecutar(comando('joven', 'k1'));
    await e.solicitar.ejecutar(comando('otro', 'k2'));
    jest.spyOn(e.turnos, 'actualizar').mockRejectedValueOnce(new Error('PostgreSQL no respondió'));

    await expect(e.llamarUno()).rejects.toThrow('PostgreSQL');
    expect(await e.motor.personasDelante(FILA, primero.id, 2)).toBe(0);
  });

  it('un error que se repetiría siempre no devuelve el turno a la cabeza de la fila', async () => {
    const e = armar();
    const turno = await e.solicitar.ejecutar(comando('joven', 'k1'));
    jest.spyOn(e.turnos, 'actualizar').mockRejectedValueOnce(new ConflictoError('NUMERO_DUPLICADO', 'número repetido'));

    await expect(e.llamarUno()).rejects.toMatchObject({ codigo: 'NUMERO_DUPLICADO' });
    expect(await e.enFila(turno.id)).toBe(false); // si volviera, nadie más podría ser llamado
  });

  it('RN-07: llamar mientras un preferencial vuelve a la fila general no lo pierde', async () => {
    const e = armar();
    const turno = await e.solicitar.ejecutar(comando('joven', 'k1', true));
    await e.llamarUno();
    const real = e.turnos.actualizar.bind(e.turnos);
    e.turnos.actualizar = async (t: Turno) => {
      e.turnos.actualizar = real;
      await e.llamarUno(companero).catch(() => undefined);
      return real(t);
    };

    await e.atender.ejecutar({ turnoId: turno.id, accion: 'VERIFICAR_PREFERENCIAL', funcionario, cumplePreferencial: false });
    expect((await e.turnos.obtener(turno.id))?.estado).toBe(EstadoTurno.EN_ESPERA);
    expect(await e.enFila(turno.id)).toBe(true);
  });

  it('iniciar justo cuando el asociado confirma: no le falla al funcionario', async () => {
    const e = armar();
    const turno = await e.solicitar.ejecutar(comando('joven', 'k1'));
    await e.llamarUno();
    jest.spyOn(e.turnos, 'actualizar').mockRejectedValueOnce(new ConflictoError('TURNO_MODIFICADO', 'confirmó'));

    expect((await e.atender.ejecutar({ turnoId: turno.id, accion: 'INICIAR', funcionario })).estado).toBe(EstadoTurno.EN_ATENCION);
  });

  it('en 500 órdenes distintos de operaciones simultáneas ningún pendiente queda fuera de la fila', async () => {
    const fallos: string[] = [];
    for (let semilla = 1; semilla <= 500; semilla++) fallos.push(...(await mezclar(semilla)));
    expect(fallos.slice(0, 5)).toEqual([]);
  }, 60_000);
});

/** Corre solicitudes, llamados, cancelaciones, confirmaciones y vencimientos intercalados según la semilla. */
async function mezclar(semilla: number): Promise<string[]> {
  let estado = semilla;
  const azar = () => ((estado = (estado * 48271) % 2147483647) / 2147483647);
  const pausar = async (maximo: number) => {
    for (let i = Math.floor(azar() * maximo); i > 0; i--) await Promise.resolve();
  };

  const e = armar();
  // Cada llamada a la base y al motor tarda un número distinto de pasos, antes y después de su efecto.
  const conDemora = (objeto: object, metodos: string[]) => {
    const destino = objeto as Record<string, (...datos: unknown[]) => Promise<unknown>>;
    for (const metodo of metodos) {
      const real = destino[metodo].bind(objeto);
      destino[metodo] = async (...datos) => {
        await pausar(12);
        const resultado = await real(...datos);
        await pausar(12);
        return resultado;
      };
    }
  };
  conDemora(e.turnos, ['guardarNuevo', 'actualizar', 'obtener', 'buscarEnVentanilla']);
  conDemora(e.motor, ['encolar', 'siguiente', 'retirar']);

  const personas = ['a', 'b', 'c', 'd'];
  const revisar = new RevisarVencimientosService(e.turnos, e.catalogo, e.motor, e.eventos, e.notificador, e.ids, e.reloj, new CerrojoEnMemoria());
  const operaciones = personas.map((p) => async () => {
    await pausar(20);
    await e.solicitar.ejecutar(comando(p, `k-${p}`, azar() < 0.4));
  });
  for (let i = 0; i < 8; i++) {
    const tipo = azar();
    const persona = personas[Math.floor(azar() * personas.length)];
    const quien = azar() < 0.5 ? funcionario : companero;
    operaciones.push(async () => {
      await pausar(120);
      if (tipo < 0.35) return void (await e.llamarUno(quien));
      if (tipo < 0.45) return void (await revisar.ejecutar());
      if (tipo < 0.6) {
        const [enVentanilla] = await e.turnos.buscarEnVentanilla(quien.id);
        if (!enVentanilla) return;
        await e.atender.ejecutar({ turnoId: enVentanilla.id, accion: 'VERIFICAR_PREFERENCIAL', funcionario: quien, cumplePreferencial: false });
        return;
      }
      const turno = await e.turnos.buscarActivoDeAsociado(persona);
      if (!turno) return;
      if (tipo < 0.85) await e.cancelar.ejecutar({ turnoId: turno.id, solicitante: asociado(persona) });
      else if (turno.estado === EstadoTurno.PROXIMO && turno.confirmarPresencia(e.reloj.ahora())) await e.turnos.actualizar(turno);
    });
  }
  await Promise.allSettled(operaciones.map((operar) => operar()));

  const fallos: string[] = [];
  for (const id of new Set(e.eventos.eventos.map((v) => v.turnoId))) {
    if (e.solicitudes(id).length !== 1) fallos.push(`semilla ${semilla}: evento de solicitud repetido o perdido`);
  }
  for (const turno of await e.turnos.buscarHastaDiaPorEstado('2026-11-20', PENDIENTES)) {
    if (!(await e.enFila(turno.id))) fallos.push(`semilla ${semilla}: ${turno.estado} fuera de la fila`);
  }
  return fallos;
}
