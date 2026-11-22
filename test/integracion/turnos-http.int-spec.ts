import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import type { Db } from 'mongodb';
import { asignarCorreoDemo, EVENTOS_TURNO, generarCuentas, ORIGEN_SIMULADO } from '../../src/cli/demo-cuentas';
import { limpiarDemo } from '../../src/cli/demo-limpieza';
import { dejarPendientes, importarHistorial } from '../../src/cli/demo-turnos';
import { fechaLocal } from '../../src/compartido/domain/tiempo';
import { CatalogoPgAdapter } from '../../src/turnos/infrastructure/out/postgres/catalogo-pg.adapter';
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

  it('siembra identidades, historial y pendientes demo, permite atender un pendiente y limpia todo', async () => {
    const documentos = new Map<string, Map<string, { asociadoId?: string; origen?: string }>>();
    const borrados: unknown[] = [];
    const db = { collection: (nombre: string) => ({
      findOne: async (filtro: { turnoId: string; estadoNuevo: string }) => e.eventos.eventos.find((evento) =>
        evento.turnoId === filtro.turnoId && evento.estadoNuevo === filtro.estadoNuevo),
      bulkWrite: async (operaciones: { updateOne: { filter: { _id?: string; eventoId?: string }; update: { $setOnInsert: object } } }[]) => {
        const coleccion = documentos.get(nombre) ?? new Map<string, object>();
        documentos.set(nombre, coleccion);
        let upsertedCount = 0;
        for (const { updateOne: { filter, update } } of operaciones) {
          const clave = filter._id ?? filter.eventoId!;
          if (coleccion.has(clave)) continue;
          coleccion.set(clave, update.$setOnInsert);
          upsertedCount++;
        }
        return { upsertedCount };
      },
      deleteMany: async (filtro: unknown) => {
        borrados.push(filtro);
        return { deletedCount: 1 };
      },
    }) } as unknown as Db;
    const catalogoPg = new CatalogoPgAdapter(e.pool, {
      obtener: async () => null, guardar: async () => undefined, invalidar: async () => undefined,
    });
    const catalogo = {
      listarAgencias: async () => (await catalogoPg.listarAgencias()).filter(({ id }) => id === MOCOA),
      obtenerFila: catalogoPg.obtenerFila.bind(catalogoPg),
    };
    const primera = await generarCuentas(e.pool, catalogo, 7);
    const [agencia] = primera.agencias;
    expect(agencia.administradores).toHaveLength(1);
    expect(agencia.funcionarios.length).toBeGreaterThanOrEqual(3);
    expect(agencia.funcionarios.length).toBeLessThanOrEqual(5);
    expect(agencia.funcionarios[0].servicioId).toBeNull();
    expect(agencia.asociados.length).toBeGreaterThanOrEqual(1000);
    expect(agencia.asociados.length).toBeLessThanOrEqual(3000);
    const [asociado] = agencia.asociados;
    const [administrador] = agencia.administradores;
    await asignarCorreoDemo(e.pool, administrador, 'demo-activado@pruebas.test');
    expect(await generarCuentas(e.pool, catalogo, 42)).toEqual(primera);
    expect((await e.pool.query('SELECT email, email_verificado FROM usuario WHERE id = $1', [administrador])).rows[0])
      .toEqual({ email: 'demo-activado@pruebas.test', email_verificado: false });

    const turno = {
      id: randomUUID(), agenciaId: MOCOA, servicioId: CAJA, asociadoId: asociado, fecha: '2026-01-26', numero: 1,
      tipoAtencion: 'GENERAL', estado: 'CANCELADO', canal: 'WEB', motivo: 'CANCELADO_POR_ASOCIADO',
      solicitadoEn: '2026-01-26T13:00:00.000Z', finEn: '2026-01-26T13:05:00.000Z',
    };
    const base = { turnoId: turno.id, agenciaId: MOCOA, servicioId: CAJA, asociadoId: asociado, canal: 'WEB', tipoAtencion: 'GENERAL', datos: {} };
    const eventos = [
      { ...base, eventoId: `${turno.id}:solicitud`, tipo: 'TurnoSolicitado', estadoNuevo: 'SOLICITADO', ocurridoEn: turno.solicitadoEn },
      { ...base, eventoId: `${turno.id}:cancelado`, tipo: 'TurnoCancelado', estadoNuevo: 'CANCELADO', ocurridoEn: turno.finEn },
    ];
    const entrada = () => Readable.from([JSON.stringify({ turno, eventos })]);
    expect(await importarHistorial(e.pool, db, entrada())).toEqual({ turnos: 1, eventos: 2, procesados: 1 });
    expect(await importarHistorial(e.pool, db, entrada())).toEqual({ turnos: 0, eventos: 0, procesados: 1 });
    // El historial simulado va a la colección normal, marcado para reconocerlo y borrarlo.
    expect([...documentos.get(EVENTOS_TURNO)!.values()].map(({ origen }) => origen)).toEqual([ORIGEN_SIMULADO, ORIGEN_SIMULADO]);
    expect((await e.pool.query('SELECT estado FROM turno WHERE id = $1', [turno.id])).rows[0].estado).toBe('CANCELADO');

    const entradaPendientes = { fecha: fechaLocal(e.reloj.ahora()), agencias: [
      { agenciaId: MOCOA, servicioId: CAJA, asociados: agencia.asociados.slice(0, 8) },
    ] };
    const sembrarPendientes = () => dejarPendientes(
      e.pool, db, catalogo, e.jornadas, e.turnos, e.solicitar, entradaPendientes, 'integracion', e.reloj,
    );
    const pendientes = await sembrarPendientes();
    expect(pendientes.pendientes).toBe(3);
    const idsPendientes = pendientes.turnos.map(({ id }) => id);
    expect((await sembrarPendientes()).turnos.map(({ id }) => id)).toEqual(idsPendientes);
    const funcionario = await e.crearPersona('Funcionario que atiende demo', [{ rol: 'FUNCIONARIO', agenciaId: MOCOA, servicioId: CAJA }]);
    const opciones = { token: funcionario.token };
    const llamado = await e.pedir<{ id: string }>('POST', `/filas/${MOCOA}/${CAJA}/siguiente`, opciones);
    expect(llamado).toMatchObject({ status: 200, cuerpo: { estado: 'LLAMADO' } });
    expect(idsPendientes).toContain(llamado.cuerpo.id);
    expect(await e.pedir('POST', `/turnos/${llamado.cuerpo.id}/iniciar`, opciones)).toMatchObject({ status: 200 });
    expect(await e.pedir('POST', `/turnos/${llamado.cuerpo.id}/finalizar`, opciones))
      .toMatchObject({ status: 200, cuerpo: { estado: 'ATENDIDO' } });
    expect((await sembrarPendientes()).pendientes).toBe(2);

    // Limpieza: fuera de la fila del motor, sin cuentas ni turnos de la demostración.
    const participantes = Number((await e.pool.query('SELECT count(*) AS n FROM demo_participante')).rows[0].n);
    const limpieza = await limpiarDemo(e.pool, db, e.motor);
    expect(limpieza).toMatchObject({ cuentas: participantes, retiradosDeFilas: 2 });
    expect(await e.motor.siguiente(`${MOCOA}:${CAJA}`, 2)).toBeNull();
    expect(borrados).toEqual([{ asociadoId: { $in: expect.arrayContaining([asociado, administrador]) } }]);
    const quedan = await e.pool.query(
      `SELECT (SELECT count(*) FROM demo_participante) AS participantes, (SELECT count(*) FROM turno WHERE id = ANY($1::uuid[])) AS turnos,
              (SELECT count(*) FROM usuario WHERE id = $2) AS cuentas, (SELECT count(*) FROM demo_escenario) AS escenarios`,
      [[turno.id, ...idsPendientes], administrador],
    );
    expect(quedan.rows[0]).toEqual({ participantes: '0', turnos: '0', cuentas: '0', escenarios: '0' });
    // El funcionario real que atendió un turno demo conserva su cuenta.
    expect((await e.pool.query('SELECT count(*) AS n FROM usuario WHERE id = $1', [funcionario.id])).rows[0].n).toBe('1');
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

  describe('Turnos trabados (RN-13, CU-04)', () => {
    it('recupera la ventanilla, no deja llamar otro y cierra la atención olvidada de otro día', async () => {
      const ana = await e.crearPersona('Ana Ventanilla');
      const funcionario = await e.crearPersona('Funcionario Ventanilla', [{ rol: 'FUNCIONARIO', agenciaId: MOCOA }]);
      const opciones = { token: funcionario.token };
      expect((await e.pedir('GET', '/turnos/en-ventanilla', opciones)).status).toBe(204);
      expect((await e.pedir('GET', '/turnos/en-ventanilla', { token: ana.token })).status).toBe(403);

      expect((await pedirTurno(ana)).status).toBe(201);
      const llamado = await e.pedir<{ id: string }>('POST', `/filas/${MOCOA}/${CAJA}/siguiente`, opciones);
      expect(llamado.status).toBe(200);
      const { id } = llamado.cuerpo;
      expect((await e.pedir('POST', `/turnos/${id}/iniciar`, opciones)).status).toBe(200);

      // Lo que hace el panel al recargar.
      expect(await e.pedir('GET', '/turnos/en-ventanilla', opciones)).toMatchObject({ status: 200, cuerpo: { id, estado: 'EN_ATENCION' } });
      expect(await e.pedir('POST', `/filas/${MOCOA}/${CAJA}/siguiente`, opciones)).toMatchObject({
        status: 409,
        cuerpo: { codigo: 'TURNO_EN_VENTANILLA' },
      });

      await e.pool.query(
        "UPDATE turno SET fecha = '2026-11-16', numero = numero + 900, inicio_atencion_en = '2026-11-16T15:00:00Z' WHERE id = $1",
        [id],
      );
      expect(await e.vencimientos.ejecutar()).toMatchObject({ atencionesCerradas: 1 });
      expect(await estadoEnBd(id)).toEqual({ estado: 'ATENDIDO', motivo: 'CIERRE_AUTOMATICO' });
      expect((await e.pedir('GET', '/turnos/en-ventanilla', opciones)).status).toBe(204);
    });

    it('cancela en PostgreSQL un pendiente de otro día y el asociado puede pedir de nuevo', async () => {
      const beto = await e.crearPersona('Beto Rezagado');
      const turno = await pedirTurno(beto);
      await e.pool.query("UPDATE turno SET fecha = '2026-11-17', numero = numero + 900 WHERE id = $1", [turno.cuerpo.id]);
      expect((await pedirTurno(beto)).cuerpo).toMatchObject({ codigo: 'TURNO_ACTIVO' });

      expect(await e.cierre.cierreAutomatico()).toMatchObject([{ fecha: '2026-11-17', cancelados: 1 }]);
      expect(await estadoEnBd(turno.cuerpo.id)).toEqual({ estado: 'CANCELADO', motivo: 'CIERRE_AGENCIA' });
      expect((await pedirTurno(beto)).status).toBe(201);
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
