import { PermisoDenegadoError } from '../src/compartido/domain/errores';
import type { Principal } from '../src/compartido/domain/principal';
import { EstadoTurno } from '../src/turnos/domain/estado-turno';
import { AGENCIA, armarEscenario, comando, OTRA_AGENCIA, SERVICIO } from './armar-escenario';

const funcionario: Principal = { id: 'f1', roles: [{ rol: 'FUNCIONARIO', agenciaId: AGENCIA }] };
const funcionarioDeOtraAgencia: Principal = { id: 'f2', roles: [{ rol: 'FUNCIONARIO', agenciaId: OTRA_AGENCIA }] };

describe('Caso de uso LlamarSiguiente', () => {
  it('llama primero al preferencial y luego al general (RN-08)', async () => {
    const e = armarEscenario();
    const general = await e.solicitar.ejecutar(comando('joven', 'k1'));
    const preferencial = await e.solicitar.ejecutar(comando('mayor', 'k2'));

    const primero = await e.llamar.ejecutar({ agenciaId: AGENCIA, servicioId: SERVICIO, funcionario });
    const segundo = await e.llamar.ejecutar({ agenciaId: AGENCIA, servicioId: SERVICIO, funcionario });

    expect(primero?.id).toBe(preferencial.id);
    expect(primero?.estado).toBe(EstadoTurno.LLAMADO);
    expect(segundo?.id).toBe(general.id);
    expect(await e.llamar.ejecutar({ agenciaId: AGENCIA, servicioId: SERVICIO, funcionario })).toBeNull();
  });

  it('un funcionario de otra agencia no puede llamar (RN-14)', async () => {
    const e = armarEscenario();
    await e.solicitar.ejecutar(comando('joven', 'k1'));
    await expect(
      e.llamar.ejecutar({ agenciaId: AGENCIA, servicioId: SERVICIO, funcionario: funcionarioDeOtraAgencia }),
    ).rejects.toBeInstanceOf(PermisoDenegadoError);
  });

  it('ConsultarMiTurno combina la posición del motor y los datos de la analítica', async () => {
    const e = armarEscenario();
    await e.solicitar.ejecutar(comando('joven', 'k1'));
    await e.solicitar.ejecutar(comando('otro', 'k2'));
    const miTurno = await e.consultar.ejecutar('otro');
    // 1 persona delante · 4 min · 2 ventanillas · p = 0.2  =>  1 · 4 / (2 · 0.8) = 2.5 min
    expect(miTurno?.personasDelante).toBe(1);
    expect(miTurno?.esperaEstimadaMin).toBe(2.5);
  });
});
