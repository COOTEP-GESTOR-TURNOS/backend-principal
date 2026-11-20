import { ConsultarIndicadoresService, totalizar } from '../../src/analitica/application/use-cases/consultar-indicadores.service';
import { AnaliticaEnMemoria, CacheEnMemoria } from '../../src/analitica/infrastructure/out/memoria/adaptadores-en-memoria';
import { NoEncontradoError, PermisoDenegadoError, ReglaNegocioError } from '../../src/compartido/domain/errores';
import type { Principal } from '../../src/compartido/domain/principal';
import { AuditoriaEnMemoria } from '../../src/identidad/infrastructure/out/memoria/adaptadores-en-memoria';
import { Fila } from '../../src/turnos/domain/fila';
import { CatalogoEnMemoria, RelojFijo } from '../../src/turnos/infrastructure/out/memoria/adaptadores-en-memoria';

const MOCOA = 'a0000000-0000-4000-8000-000000000001';
const ORITO = 'a0000000-0000-4000-8000-000000000003';
const CAJA = 'b0000000-0000-4000-8000-000000000001';

const fila = (agencia: string) =>
  new Fila(agencia, CAJA, 'C', 3, { apertura: '08:00', cierre: '16:00' }, { nProximo: 3, maxPreferencialesSeguidos: 2, edadAdultoMayor: 60 }, true);

const superadmin: Principal = { id: '11111111-0000-4000-8000-000000000001', roles: [{ rol: 'SUPERADMIN' }] };
const directivoMocoa: Principal = { id: '11111111-0000-4000-8000-000000000002', roles: [{ rol: 'ADMIN_AGENCIA', agenciaId: MOCOA }] };

/** Lunes 16 de noviembre de 2026, 10:00 en Colombia. */
function armar() {
  const analitica = new AnaliticaEnMemoria();
  analitica.indicadoresPorAgencia = {
    [MOCOA]: { atendidos: 300, cancelados: 40, ausentes: 60, esperaPromedioMin: 10, atencionPromedioMin: 6, proporcionPreferencial: 0.2 },
    [ORITO]: { atendidos: 100, cancelados: 0, ausentes: 0, esperaPromedioMin: 2, atencionPromedioMin: 4, proporcionPreferencial: 0.1 },
  };
  const auditoria = new AuditoriaEnMemoria();
  const servicio = new ConsultarIndicadoresService(
    new CatalogoEnMemoria([fila(MOCOA), fila(ORITO)]),
    analitica,
    new CacheEnMemoria(),
    new RelojFijo(new Date('2026-11-16T15:00:00Z')),
    auditoria,
  );
  return { servicio, analitica, auditoria };
}

describe('RF-19: indicadores con el ámbito del administrador', () => {
  it('el superadministrador ve todas las agencias y el total ponderado', async () => {
    const { servicio } = armar();
    const t = await servicio.ejecutar(superadmin, {});
    expect(t.ambito).toBe('GLOBAL');
    expect(t.agencias.map((a) => a.agenciaId)).toEqual([MOCOA, ORITO]);
    expect(t).not.toHaveProperty('paginacion');
    // Espera ponderada por atendidos: (10·300 + 2·100) / 400 = 8; preferencial por todos los turnos: (0,2·400 + 0,1·100) / 500.
    expect(t.total).toEqual({ atendidos: 400, cancelados: 40, ausentes: 60, esperaPromedioMin: 8, atencionPromedioMin: 5.5, proporcionPreferencial: 0.18 });
  });

  it('pagina las agencias en el orden del catálogo y conserva el total de todo el ámbito', async () => {
    const { servicio } = armar();
    const actor: Principal = { ...directivoMocoa, roles: [{ rol: 'ADMIN_AGENCIA', agenciaId: ORITO }, ...directivoMocoa.roles] };
    const primera = await servicio.ejecutar(actor, { tamano: 1 });
    const segunda = await servicio.ejecutar(actor, { pagina: 2, tamano: 1 });
    const fuera = await servicio.ejecutar(actor, { pagina: 3, tamano: 1 });

    expect(primera).toMatchObject({
      agencias: [{ agenciaId: MOCOA }],
      paginacion: { pagina: 1, tamano: 1, total: 2, totalPaginas: 2 },
    });
    expect(segunda).toMatchObject({
      agencias: [{ agenciaId: ORITO }],
      paginacion: { pagina: 2, tamano: 1, total: 2, totalPaginas: 2 },
    });
    expect(fuera.agencias).toEqual([]);
    expect(primera.total.atendidos).toBe(400);
    expect(segunda.total).toEqual(primera.total);
    expect(fuera.total).toEqual(primera.total);
  });

  it('aplica el tamaño predeterminado y respeta el filtro y los permisos de agencia', async () => {
    const { servicio } = armar();
    const t = await servicio.ejecutar(directivoMocoa, { pagina: 1, agenciaId: MOCOA });
    expect(t.agencias.map((a) => a.agenciaId)).toEqual([MOCOA]);
    expect(t.paginacion).toEqual({ pagina: 1, tamano: 20, total: 1, totalPaginas: 1 });
    await expect(servicio.ejecutar(directivoMocoa, { pagina: 2, agenciaId: ORITO })).rejects.toBeInstanceOf(PermisoDenegadoError);
  });

  it('por defecto toma los últimos 30 días hasta hoy en Colombia', async () => {
    const { servicio, analitica } = armar();
    const t = await servicio.ejecutar(superadmin, { agenciaId: MOCOA });
    expect([t.desde, t.hasta]).toEqual(['2026-10-18', '2026-11-16']);
    expect(analitica.consultasIndicadores).toEqual([`${MOCOA}:2026-10-18:2026-11-16`]);
  });

  it('el directivo de Mocoa solo ve Mocoa', async () => {
    const { servicio } = armar();
    const t = await servicio.ejecutar(directivoMocoa, {});
    expect(t.ambito).toBe('AGENCIA');
    expect(t.agencias.map((a) => a.agenciaId)).toEqual([MOCOA]);
  });

  it('PR-16: pedir los indicadores de otra agencia es 403 y queda en la auditoría', async () => {
    const { servicio, auditoria } = armar();
    await expect(servicio.ejecutar(directivoMocoa, { agenciaId: ORITO })).rejects.toBeInstanceOf(PermisoDenegadoError);
    expect(auditoria.entradas).toMatchObject([{ accion: 'INTENTO_FUERA_DE_AMBITO', ambito: ORITO, objetivoTipo: 'INDICADORES' }]);
  });

  it('si la analítica no responde para una agencia, las demás se muestran y el total la excluye', async () => {
    const { servicio, analitica } = armar();
    analitica.agenciasCaidas.add(ORITO);
    const t = await servicio.ejecutar(superadmin, {});
    expect(t.agencias.find((a) => a.agenciaId === ORITO)).toMatchObject({ disponible: false, atendidos: 0 });
    expect(t.total.atendidos).toBe(300);
  });

  it('la segunda consulta sale de la caché', async () => {
    const { servicio, analitica } = armar();
    await servicio.ejecutar(superadmin, {});
    await servicio.ejecutar(superadmin, {});
    expect(analitica.consultasIndicadores).toHaveLength(2);
  });

  it('valida el rango y la agencia', async () => {
    const { servicio } = armar();
    await expect(servicio.ejecutar(superadmin, { desde: '2026-11-10', hasta: '2026-11-01' })).rejects.toBeInstanceOf(ReglaNegocioError);
    await expect(servicio.ejecutar(superadmin, { desde: '2025-01-01', hasta: '2026-11-16' })).rejects.toBeInstanceOf(ReglaNegocioError);
    await expect(servicio.ejecutar(superadmin, { agenciaId: 'a0000000-0000-4000-8000-000000000099' })).rejects.toBeInstanceOf(NoEncontradoError);
  });

  it('un rol sin agencias administradas no tiene indicadores', async () => {
    const { servicio } = armar();
    await expect(servicio.ejecutar({ id: 'x', roles: [{ rol: 'FUNCIONARIO', agenciaId: MOCOA }] }, {})).rejects.toBeInstanceOf(PermisoDenegadoError);
  });

  it('el total de una lista vacía es cero', () => {
    expect(totalizar([])).toEqual({ atendidos: 0, cancelados: 0, ausentes: 0, esperaPromedioMin: 0, atencionPromedioMin: 0, proporcionPreferencial: 0 });
  });
});
