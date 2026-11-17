import { mediana, percentil, resumir } from '../src/cli/estadisticas';
import { enParalelo, enSecuencia } from '../src/turnos/application/combinar';
import { ConsultarMiTurnoService } from '../src/turnos/application/use-cases/consultar-mi-turno.service';
import { EstimadorEnMemoria } from '../src/turnos/infrastructure/out/memoria/adaptadores-en-memoria';
import { armarEscenario, comando } from './armar-escenario';

/** Una llamada que anota cuándo empieza y cuándo termina, y se resuelve cuando la prueba quiere. */
function llamadaControlada(nombre: string, registro: string[], falla = false) {
  let terminar!: () => void;
  const hecha = new Promise<void>((r) => (terminar = r));
  const llamada = async () => {
    registro.push(`inicia ${nombre}`);
    await hecha;
    registro.push(`termina ${nombre}`);
    if (falla) throw new Error(`${nombre} falló`);
    return nombre;
  };
  return { llamada, terminar };
}

describe('Sección 10: cómo se esperan las dos llamadas de la consulta de mi turno', () => {
  it('en paralelo las dos salen antes de que termine la primera', async () => {
    const registro: string[] = [];
    const a = llamadaControlada('motor', registro);
    const b = llamadaControlada('analítica', registro);
    const resultado = enParalelo(a.llamada, b.llamada);
    await Promise.resolve();
    expect(registro).toEqual(['inicia motor', 'inicia analítica']);
    b.terminar();
    a.terminar();
    await expect(resultado).resolves.toEqual([
      { status: 'fulfilled', value: 'motor' },
      { status: 'fulfilled', value: 'analítica' },
    ]);
  });

  it('en secuencia la segunda espera a que termine la primera', async () => {
    const registro: string[] = [];
    const a = llamadaControlada('motor', registro);
    const b = llamadaControlada('analítica', registro);
    const resultado = enSecuencia(a.llamada, b.llamada);
    await Promise.resolve();
    expect(registro).toEqual(['inicia motor']);
    a.terminar();
    b.terminar();
    await resultado;
    expect(registro).toEqual(['inicia motor', 'termina motor', 'inicia analítica', 'termina analítica']);
  });

  it('las dos formas siguen aunque una llamada falle, como Promise.allSettled', async () => {
    for (const combinar of [enParalelo, enSecuencia]) {
      const registro: string[] = [];
      const a = llamadaControlada('motor', registro, true);
      const b = llamadaControlada('analítica', registro);
      a.terminar();
      b.terminar();
      const [primera, segunda] = await combinar(a.llamada, b.llamada);
      expect(primera.status).toBe('rejected');
      expect(segunda).toEqual({ status: 'fulfilled', value: 'analítica' });
    }
  });

  it('el caso de uso da el mismo resultado en secuencia y en paralelo', async () => {
    const e = armarEscenario();
    await e.solicitar.ejecutar(comando('joven', 'k-1'));
    await e.solicitar.ejecutar(comando('mayor', 'k-2'));
    const secuencial = new ConsultarMiTurnoService(e.turnos, e.catalogo, e.motor, new EstimadorEnMemoria(), e.reloj, enSecuencia);
    expect(await secuencial.ejecutar('joven')).toEqual(await e.consultar.ejecutar('joven'));
  });
});

describe('Estadísticas de las mediciones', () => {
  const del1al100 = Array.from({ length: 100 }, (_, i) => 100 - i); // desordenadas a propósito

  it('percentil 95 por rango más cercano y mediana', () => {
    expect(percentil(del1al100, 95)).toBe(95);
    expect(percentil(del1al100, 100)).toBe(100);
    expect(mediana(del1al100)).toBe(50.5);
    expect(mediana([3, 1, 2])).toBe(2);
  });

  it('resume con dos decimales y rechaza una lista vacía', () => {
    expect(resumir([1.234, 2.345, 9.999])).toEqual({ n: 3, medianaMs: 2.35, p95Ms: 10, minimoMs: 1.23, maximoMs: 10 });
    expect(() => resumir([])).toThrow('No hay valores');
  });
});
