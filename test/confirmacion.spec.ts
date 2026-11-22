import { ConflictoError } from '../src/compartido/domain/errores';
import type { Principal } from '../src/compartido/domain/principal';
import { ConfirmarPresenciaService } from '../src/turnos/application/use-cases/atender-turno.service';
import type { ResumenTurno } from '../src/turnos/application/resumen-turno';
import { EstadoTurno } from '../src/turnos/domain/estado-turno';
import type { FilasGateway } from '../src/turnos/infrastructure/in/ws/filas.gateway';
import { NotificadorSocketAdapter } from '../src/turnos/infrastructure/out/socketio/notificador-socket.adapter';
import { AGENCIA, armarEscenario, comando, SERVICIO } from './armar-escenario';

const joven: Principal = { id: 'joven', roles: [{ rol: 'ASOCIADO' }] };
const funcionario: Principal = { id: 'f1', roles: [{ rol: 'FUNCIONARIO', agenciaId: AGENCIA }] };

function armar() {
  const e = armarEscenario();
  const confirmar = new ConfirmarPresenciaService(e.turnos, e.catalogo, e.eventos, e.notificador, e.ids, e.reloj);
  return { ...e, confirmar };
}

describe('RN-10: el servidor informa la confirmación', () => {
  it('la traen la solicitud, la confirmación, «mi turno» y el aviso a los demás dispositivos', async () => {
    const e = armar();
    const turno = await e.solicitar.ejecutar(comando('joven', 'k1'));
    expect(turno.confirmado).toBe(false);
    expect((await e.consultar.ejecutar('joven'))?.confirmado).toBe(false);

    expect((await e.confirmar.ejecutar(turno.id, joven)).confirmado).toBe(true);
    expect((await e.consultar.ejecutar('joven'))?.confirmado).toBe(true);
    expect(e.notificador.turnos.at(-1)?.resumen).toMatchObject({ estado: 'PROXIMO', confirmado: true });
  });

  it('el evento turno:proximo, que pide confirmar, no se repite para un turno confirmado', async () => {
    const emitidos: string[] = [];
    const sala = { emit: (evento: string) => emitidos.push(evento) };
    const socket = new NotificadorSocketAdapter({ servidor: { to: () => sala } } as unknown as FilasGateway);
    const base = { id: 't', estado: EstadoTurno.PROXIMO } as ResumenTurno;

    await socket.turnoActualizado('joven', { ...base, confirmado: false });
    expect(emitidos).toEqual(['turno:estado', 'turno:proximo']);
    emitidos.length = 0;
    await socket.turnoActualizado('joven', { ...base, confirmado: true });
    expect(emitidos).toEqual(['turno:estado']);
  });
});

describe('RN-10: solo se confirma dentro del plazo', () => {
  it('un minuto antes de vencer todavía se acepta', async () => {
    const e = armar();
    const turno = await e.solicitar.ejecutar(comando('joven', 'k1'));
    e.reloj.avanzar(4);
    expect((await e.confirmar.ejecutar(turno.id, joven)).confirmado).toBe(true);
  });

  it('al vencer se rechaza, aunque la revisión periódica todavía no haya pasado', async () => {
    const e = armar();
    const turno = await e.solicitar.ejecutar(comando('joven', 'k1'));
    e.reloj.avanzar(5);
    await expect(e.confirmar.ejecutar(turno.id, joven)).rejects.toMatchObject({ codigo: 'PLAZO_CONFIRMACION_VENCIDO' });
    expect((await e.turnos.obtener(turno.id))?.confirmado).toBe(false);
  });

  it('un turno de otro día no se confirma', async () => {
    const e = armar();
    const turno = await e.solicitar.ejecutar(comando('joven', 'k1'));
    e.reloj.avanzar(24 * 60);
    await expect(e.confirmar.ejecutar(turno.id, joven)).rejects.toMatchObject({ codigo: 'PLAZO_CONFIRMACION_VENCIDO' });
  });

  it('repetir una confirmación hecha a tiempo no falla después del plazo', async () => {
    const e = armar();
    const turno = await e.solicitar.ejecutar(comando('joven', 'k1'));
    await e.confirmar.ejecutar(turno.id, joven);
    e.reloj.avanzar(20);
    expect((await e.confirmar.ejecutar(turno.id, joven)).confirmado).toBe(true);
  });

  it('un turno ya llamado se puede confirmar: su plazo es el de presentarse (RN-11)', async () => {
    const e = armar();
    const turno = await e.solicitar.ejecutar(comando('joven', 'k1'));
    await e.llamar.ejecutar({ agenciaId: AGENCIA, servicioId: SERVICIO, funcionario });
    e.reloj.avanzar(6);
    expect((await e.confirmar.ejecutar(turno.id, joven)).confirmado).toBe(true);
  });

  it('confirmar justo cuando lo llaman no falla: se relee y queda confirmado', async () => {
    const e = armar();
    const turno = await e.solicitar.ejecutar(comando('joven', 'k1'));
    jest.spyOn(e.turnos, 'actualizar').mockRejectedValueOnce(new ConflictoError('TURNO_MODIFICADO', 'lo llamaron'));
    expect((await e.confirmar.ejecutar(turno.id, joven)).confirmado).toBe(true);
    expect((await e.turnos.obtener(turno.id))?.confirmado).toBe(true);
  });

  it('un turno ajeno sigue respondiendo como inexistente, también fuera de plazo (RN-14)', async () => {
    const e = armar();
    const turno = await e.solicitar.ejecutar(comando('joven', 'k1'));
    e.reloj.avanzar(10);
    await expect(e.confirmar.ejecutar(turno.id, { id: 'otro', roles: [] })).rejects.toMatchObject({ codigo: 'TURNO_NO_EXISTE' });
  });
});
