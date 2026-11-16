import { ConsultarRecomendacionesService } from '../../src/analitica/application/use-cases/consultar-recomendaciones.service';
import { AnaliticaEnMemoria, CacheEnMemoria } from '../../src/analitica/infrastructure/out/memoria/adaptadores-en-memoria';
import { NoEncontradoError, ReglaNegocioError } from '../../src/compartido/domain/errores';
import { Fila } from '../../src/turnos/domain/fila';
import { CatalogoEnMemoria, RelojFijo } from '../../src/turnos/infrastructure/out/memoria/adaptadores-en-memoria';

const AGENCIA = 'a0000000-0000-4000-8000-000000000001';
const CAJA = 'b0000000-0000-4000-8000-000000000001';
const CREDITOS = 'b0000000-0000-4000-8000-000000000002';

/** Lunes 16 de noviembre de 2026, 10:40 en Colombia (15:40 UTC); agencia de 08:00 a 16:00. */
function armar(instante = new Date('2026-11-16T15:40:00Z')) {
  const fila = new Fila(AGENCIA, CAJA, 'C', 3, { apertura: '08:00', cierre: '16:00' }, { nProximo: 3, maxPreferencialesSeguidos: 2, edadAdultoMayor: 60 }, true);
  const analitica = new AnaliticaEnMemoria({
    fecha: '2026-11-16',
    tipoDia: 'HABIL',
    franjas: [
      { franja: '09:00', esperaMedianaMin: 2.5, turnos: 140 }, // ya pasó a las 10:40
      { franja: '14:30', esperaMedianaMin: 3.1, turnos: 120 },
      { franja: '16:00', esperaMedianaMin: 1.0, turnos: 25 }, // fuera del horario
    ],
  });
  const cache = new CacheEnMemoria();
  const servicio = new ConsultarRecomendacionesService(new CatalogoEnMemoria([fila]), analitica, cache, new RelojFijo(instante));
  return { servicio, analitica, cache };
}

describe('RF-10: recomendación de horario', () => {
  it('para hoy quita las franjas que ya pasaron y las que caen fuera del horario', async () => {
    const { servicio } = armar();
    const r = await servicio.ejecutar({ agenciaId: AGENCIA, servicioId: CAJA });
    expect(r.fecha).toBe('2026-11-16');
    expect(r.disponible).toBe(true);
    expect(r.horario).toEqual({ apertura: '08:00', cierre: '16:00' });
    expect(r.franjas).toEqual([{ desde: '14:30', hasta: '15:00', esperaMedianaMin: 3.1, turnos: 120 }]);
  });

  it('para mañana conserva las franjas de la mañana', async () => {
    const { servicio } = armar();
    const r = await servicio.ejecutar({ agenciaId: AGENCIA, servicioId: CAJA, fecha: '2026-11-17' });
    expect(r.franjas.map((f) => f.desde)).toEqual(['09:00', '14:30']);
  });

  it('la segunda consulta sale de la caché (15 min) sin llamar a la analítica', async () => {
    const { servicio, analitica, cache } = armar();
    await servicio.ejecutar({ agenciaId: AGENCIA, servicioId: CAJA });
    await servicio.ejecutar({ agenciaId: AGENCIA, servicioId: CAJA });
    expect(analitica.llamadas).toBe(1);
    expect([...cache.datos.keys()]).toEqual([`recomendacion:${AGENCIA}:${CAJA}:2026-11-16`]);
  });

  it('si la analítica no responde, avisa que no está disponible y no guarda nada', async () => {
    const { servicio, analitica, cache } = armar();
    analitica.caida = true;
    const r = await servicio.ejecutar({ agenciaId: AGENCIA, servicioId: CAJA });
    expect(r).toMatchObject({ disponible: false, franjas: [] });
    expect(cache.datos.size).toBe(0);
  });

  it('sin historial suficiente responde una lista vacía', async () => {
    const { servicio, analitica } = armar();
    analitica.respuesta = null;
    const r = await servicio.ejecutar({ agenciaId: AGENCIA, servicioId: CAJA });
    expect(r).toMatchObject({ disponible: true, franjas: [], tipoDia: null });
  });

  it('rechaza una fila que la agencia no ofrece y fechas pasadas o lejanas', async () => {
    const { servicio } = armar();
    await expect(servicio.ejecutar({ agenciaId: AGENCIA, servicioId: CREDITOS })).rejects.toBeInstanceOf(NoEncontradoError);
    await expect(servicio.ejecutar({ agenciaId: AGENCIA, servicioId: CAJA, fecha: '2026-11-15' })).rejects.toBeInstanceOf(ReglaNegocioError);
    await expect(servicio.ejecutar({ agenciaId: AGENCIA, servicioId: CAJA, fecha: '2026-11-24' })).rejects.toBeInstanceOf(ReglaNegocioError);
  });

  it('a las 23:30 de Colombia, "hoy" sigue siendo el día local y no el de UTC', async () => {
    const { servicio } = armar(new Date('2026-11-17T04:30:00Z'));
    const r = await servicio.ejecutar({ agenciaId: AGENCIA, servicioId: CAJA });
    expect(r.fecha).toBe('2026-11-16');
    expect(r.franjas).toEqual([]);
  });
});
