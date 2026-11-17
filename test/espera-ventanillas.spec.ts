import { Fila } from '../src/turnos/domain/fila';
import { armarEscenario, comando } from './armar-escenario';

describe('S1-04: las ventanillas que define la agencia cambian la espera estimada', () => {
  it('con una ventanilla en vez de dos, la misma persona espera el doble', async () => {
    const e = armarEscenario();
    await e.solicitar.ejecutar(comando('joven', 'k1'));
    await e.solicitar.ejecutar(comando('otro', 'k2'));
    expect((await e.consultar.ejecutar('otro'))?.esperaEstimadaMin).toBe(2.5);

    // El directivo cierra una ventanilla; con la caché invalidada, la siguiente lectura ya la ve.
    const { agenciaId, servicioId, prefijoTurno, horario, parametros, activa } = e.fila;
    e.catalogo.reemplazar(new Fila(agenciaId, servicioId, prefijoTurno, 1, horario, parametros, activa));

    // 1 persona delante · 4 min / (1 ventanilla · 0,8) = 5 min
    expect((await e.consultar.ejecutar('otro'))?.esperaEstimadaMin).toBe(5);
  });
});
