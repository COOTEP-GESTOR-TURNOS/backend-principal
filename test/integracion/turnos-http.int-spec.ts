import { randomUUID } from 'node:crypto';
import { CAJA, type Entorno, levantarEntorno, MOCOA, nuevaClave, type Persona } from './entorno';

/**
 * Pruebas PR-14 y PR-15 del plan de pruebas (sección 9 del informe) contra el backend principal
 * real, con PostgreSQL y Redis en contenedores. Necesitan Docker: npm run test:integracion.
 */
describe('Turnos por HTTP con PostgreSQL y Redis reales', () => {
  let e: Entorno;

  beforeAll(async () => {
    e = await levantarEntorno();
  }, 240_000);

  afterAll(async () => {
    await e?.cerrar();
  });

  const solicitud = { agenciaId: MOCOA, servicioId: CAJA, canal: 'WEB' };
  const pedirTurno = (quien: Persona, cabeceras: Record<string, string> = nuevaClave()) =>
    e.pedir<{ id: string; estado: string; codigo?: string }>('POST', '/turnos', { token: quien.token, cuerpo: solicitud, cabeceras });
  const estadoEnBd = async (turnoId: string) =>
    (await e.pool.query<{ estado: string; motivo: string | null }>('SELECT estado, motivo FROM turno WHERE id = $1', [turnoId])).rows[0];
  const activosEnBd = async (asociadoId: string) =>
    Number(
      (
        await e.pool.query<{ n: string }>(
          "SELECT count(*) AS n FROM turno WHERE asociado_id = $1 AND estado IN ('SOLICITADO', 'EN_ESPERA', 'PROXIMO', 'LLAMADO', 'EN_ATENCION')",
          [asociadoId],
        )
      ).rows[0].n,
    );

  describe('PR-14 (extremo a extremo): un asociado no puede cancelar un turno ajeno', () => {
    it('responde 404 sin revelar el turno, y el turno del otro asociado sigue en la fila', async () => {
      const ana = await e.crearPersona('Ana Prueba');
      const beto = await e.crearPersona('Beto Prueba');
      const turnoDeAna = await pedirTurno(ana);
      expect(turnoDeAna.status).toBe(201);

      const intento = await e.pedir('POST', `/turnos/${turnoDeAna.cuerpo.id}/cancelar`, { token: beto.token });
      // RN-14: un turno ajeno se trata como inexistente, igual que un id que no existe.
      expect(intento.status).toBe(404);
      expect(intento.cuerpo).toMatchObject({ status: 404, codigo: 'TURNO_NO_EXISTE' });
      const inexistente = await e.pedir('POST', `/turnos/${randomUUID()}/cancelar`, { token: beto.token });
      expect(inexistente.cuerpo).toMatchObject({ status: 404, codigo: 'TURNO_NO_EXISTE' });

      expect(await estadoEnBd(turnoDeAna.cuerpo.id)).toMatchObject({ estado: turnoDeAna.cuerpo.estado, motivo: null });

      // Control: la dueña sí puede cancelarlo por el mismo endpoint.
      const propia = await e.pedir('POST', `/turnos/${turnoDeAna.cuerpo.id}/cancelar`, { token: ana.token });
      expect(propia).toMatchObject({ status: 200, cuerpo: { estado: 'CANCELADO' } });
      expect(await estadoEnBd(turnoDeAna.cuerpo.id)).toEqual({ estado: 'CANCELADO', motivo: 'CANCELADO_POR_ASOCIADO' });
    });

    it('sin sesión responde 401 y con otro rol 403, antes de llegar al caso de uso', async () => {
      const ana = await e.crearPersona('Ana Prueba');
      const funcionario = await e.crearPersona('Funcionario Prueba', [{ rol: 'FUNCIONARIO', agenciaId: MOCOA, servicioId: CAJA }]);
      const turno = await pedirTurno(ana);

      expect((await e.pedir('POST', `/turnos/${turno.cuerpo.id}/cancelar`)).status).toBe(401);
      expect((await e.pedir('POST', `/turnos/${turno.cuerpo.id}/cancelar`, { token: funcionario.token })).status).toBe(403);
      expect((await estadoEnBd(turno.cuerpo.id)).estado).not.toBe('CANCELADO');
    });
  });

  describe('PR-15 (integración): dos solicitudes simultáneas del mismo asociado', () => {
    it('una entra (201) y la otra recibe 409 TURNO_ACTIVO; en PostgreSQL queda un solo turno activo', async () => {
      const carla = await e.crearPersona('Carla Prueba');
      // Varias rondas: en cada una las dos solicitudes salen a la vez, con claves distintas.
      for (let ronda = 0; ronda < 5; ronda++) {
        const respuestas = await Promise.all([pedirTurno(carla), pedirTurno(carla)]);
        const estados = respuestas.map((r) => r.status).sort();
        expect(estados).toEqual([201, 409]);
        const rechazada = respuestas.find((r) => r.status === 409)!;
        expect(rechazada.cuerpo).toMatchObject({ status: 409, codigo: 'TURNO_ACTIVO' });
        expect(await activosEnBd(carla.id)).toBe(1);

        // Libera RN-01 para la siguiente ronda.
        const aceptada = respuestas.find((r) => r.status === 201)!;
        expect((await e.pedir('POST', `/turnos/${aceptada.cuerpo.id}/cancelar`, { token: carla.token })).status).toBe(200);
      }
    });

    it('la misma solicitud repetida a la vez (misma Idempotency-Key) devuelve el mismo turno, no un error', async () => {
      const dario = await e.crearPersona('Darío Prueba');
      const clave = nuevaClave();
      const [a, b] = await Promise.all([pedirTurno(dario, clave), pedirTurno(dario, clave)]);
      expect([a.status, b.status].every((s) => s >= 200 && s < 300)).toBe(true);
      expect(a.cuerpo.id).toBe(b.cuerpo.id);
      expect(await activosEnBd(dario.id)).toBe(1);
    });
  });

  describe('Listados paginados', () => {
    it('pagina usuarios filtrados y conserva el total al pedir una página vacía', async () => {
      const superadmin = await e.crearPersona('Administrador de pruebas', [{ rol: 'SUPERADMIN' }]);
      const prefijo = `Página de prueba ${randomUUID()}`;
      await Promise.all(['C', 'A', 'B'].map((letra) => e.crearPersona(`${prefijo} ${letra}`)));
      const filtro = `/admin/usuarios?texto=${encodeURIComponent(prefijo)}&tamano=2`;
      const opciones = { token: superadmin.token };

      const primera = await e.pedir('GET', `${filtro}&pagina=1`, opciones);
      const segunda = await e.pedir('GET', `${filtro}&pagina=2`, opciones);
      const vacia = await e.pedir('GET', `${filtro}&pagina=3`, opciones);

      expect(primera).toMatchObject({
        status: 200,
        cuerpo: { pagina: 1, tamano: 2, total: 3, totalPaginas: 2, elementos: [{ nombre: `${prefijo} A` }, { nombre: `${prefijo} B` }] },
      });
      expect(segunda).toMatchObject({ status: 200, cuerpo: { pagina: 2, total: 3, elementos: [{ nombre: `${prefijo} C` }] } });
      expect(vacia).toMatchObject({ status: 200, cuerpo: { pagina: 3, total: 3, totalPaginas: 2, elementos: [] } });
    });

    it('lee la fila por páginas y aplica el ámbito del funcionario sin llamar los turnos', async () => {
      const creditos = 'b0000000-0000-4000-8000-000000000002';
      const ana = await e.crearPersona('Ana Créditos');
      const beto = await e.crearPersona('Beto Créditos');
      const funcionario = await e.crearPersona('Funcionario Créditos', [{ rol: 'FUNCIONARIO', agenciaId: MOCOA, servicioId: creditos }]);
      const fueraDeAmbito = await e.crearPersona('Funcionario Caja', [{ rol: 'FUNCIONARIO', agenciaId: MOCOA, servicioId: CAJA }]);
      const cuerpo = { ...solicitud, servicioId: creditos };
      const primero = await e.pedir<{ id: string }>('POST', '/turnos', { token: ana.token, cuerpo, cabeceras: nuevaClave() });
      const segundo = await e.pedir<{ id: string }>('POST', '/turnos', { token: beto.token, cuerpo, cabeceras: nuevaClave() });
      expect([primero.status, segundo.status]).toEqual([201, 201]);

      const fila = `/filas/${MOCOA}/${creditos}/turnos`;
      const opciones = { token: funcionario.token };
      expect(await e.pedir('GET', `${fila}?pagina=1&tamano=1`, opciones)).toMatchObject({
        status: 200,
        cuerpo: { pagina: 1, tamano: 1, total: 2, totalPaginas: 2, elementos: [{ turnoId: primero.cuerpo.id }] },
      });
      expect(await e.pedir('GET', `${fila}?pagina=2&tamano=1`, opciones)).toMatchObject({
        status: 200,
        cuerpo: { pagina: 2, total: 2, elementos: [{ turnoId: segundo.cuerpo.id }] },
      });
      expect(await e.pedir('GET', fila, opciones)).toMatchObject({ status: 200, cuerpo: { pagina: 1, tamano: 20, total: 2 } });
      expect((await e.pedir('GET', `${fila}?tamano=0`, opciones)).status).toBe(400);
      expect((await e.pedir('GET', fila, { token: fueraDeAmbito.token })).status).toBe(403);
      expect((await e.pedir('GET', fila)).status).toBe(401);
    });

    it('mantiene el tablero sin paginar para clientes existentes y limita el listado cuando se solicita', async () => {
      const superadmin = await e.crearPersona('Administrador de indicadores', [{ rol: 'SUPERADMIN' }]);
      const opciones = { token: superadmin.token };
      const completa = await e.pedir<{ agencias: unknown[]; total: unknown }>('GET', '/indicadores', opciones);
      const paginada = await e.pedir('GET', '/indicadores?pagina=2&tamano=3', opciones);

      expect(completa.status).toBe(200);
      expect(completa.cuerpo.agencias).toHaveLength(8);
      expect(completa.cuerpo).not.toHaveProperty('paginacion');
      expect(paginada).toMatchObject({
        status: 200,
        cuerpo: { total: completa.cuerpo.total, paginacion: { pagina: 2, tamano: 3, total: 8, totalPaginas: 3 } },
      });
      expect(paginada.cuerpo.agencias).toEqual(completa.cuerpo.agencias.slice(3, 6));
      expect((await e.pedir('GET', '/indicadores?pagina=0', opciones)).status).toBe(400);
    });
  });
});
