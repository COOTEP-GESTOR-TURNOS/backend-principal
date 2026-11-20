import { PermisoDenegadoError } from '../../src/compartido/domain/errores';
import { PoliticaAdministracion } from '../../src/identidad/domain/politica-administracion';
import { AGENCIA_MOCOA, AGENCIA_ORITO, armarIdentidad, CAJA } from '../identidad/escenario-identidad';

async function escenario() {
  const e = armarIdentidad();
  const superadmin = await e.crearCuenta('super@cootep.test', { rol: 'SUPERADMIN' });
  const adminMocoa = await e.crearCuenta('admin.mocoa@cootep.test', { rol: 'ADMIN_AGENCIA', agenciaId: AGENCIA_MOCOA });
  const funcionarioOrito = await e.crearCuenta('func.orito@cootep.test', { rol: 'FUNCIONARIO', agenciaId: AGENCIA_ORITO });
  return { e, superadmin: e.principal(superadmin), adminMocoa: e.principal(adminMocoa), funcionarioOrito };
}

describe('Política de administración (RN-15)', () => {
  const admin = { id: 'a', roles: [{ rol: 'ADMIN_AGENCIA' as const, agenciaId: AGENCIA_MOCOA }] };

  it('el administrador de agencia solo asigna funcionarios de su agencia', () => {
    expect(PoliticaAdministracion.puedeAsignar(admin, { rol: 'FUNCIONARIO', agenciaId: AGENCIA_MOCOA })).toBe(true);
    expect(PoliticaAdministracion.puedeAsignar(admin, { rol: 'FUNCIONARIO', agenciaId: AGENCIA_ORITO })).toBe(false);
    expect(PoliticaAdministracion.puedeAsignar(admin, { rol: 'ADMIN_AGENCIA', agenciaId: AGENCIA_MOCOA })).toBe(false);
    expect(PoliticaAdministracion.puedeAsignar(admin, { rol: 'SUPERADMIN' })).toBe(false);
  });

  it('valida el ámbito de cada rol', () => {
    expect(() => PoliticaAdministracion.validarAmbito({ rol: 'FUNCIONARIO' })).toThrow(/necesita una agencia/);
    expect(() => PoliticaAdministracion.validarAmbito({ rol: 'SUPERADMIN', agenciaId: AGENCIA_MOCOA })).toThrow();
    expect(() => PoliticaAdministracion.validarAmbito({ rol: 'ADMIN_AGENCIA', agenciaId: AGENCIA_MOCOA, servicioId: CAJA })).toThrow();
  });

  it('no gestiona a quien también es funcionario de otra agencia', () => {
    const roles = [
      { rol: 'FUNCIONARIO' as const, agenciaId: AGENCIA_MOCOA },
      { rol: 'FUNCIONARIO' as const, agenciaId: AGENCIA_ORITO },
    ];
    expect(PoliticaAdministracion.puedeVer(admin, roles)).toBe(true);
    expect(PoliticaAdministracion.puedeGestionar(admin, roles)).toBe(false);
  });
});

describe('Administración de usuarios (RF-18, CU-05, CU-06)', () => {
  it('el directivo de una agencia crea un funcionario de su agencia y le llega la activación', async () => {
    const { e, adminMocoa } = await escenario();
    const { usuario, activacionEnviada } = await e.administrar.crear(adminMocoa, {
      email: 'Cajero.Mocoa@cootep.test',
      nombre: 'Cajero Mocoa',
      rol: { rol: 'FUNCIONARIO', agenciaId: AGENCIA_MOCOA, servicioId: CAJA },
    });
    expect(activacionEnviada).toBe(true);
    expect(usuario).toMatchObject({ email: 'cajero.mocoa@cootep.test', tienePassword: false });

    // Con el enlace del correo define su clave y entra.
    const token = e.buzon.ultimoToken('cajero.mocoa@cootep.test');
    expect(e.buzon.enviados.at(-1)!.texto).toContain('tipo=activar');
    await e.cuentas.restablecerClave({ token, claveNueva: 'clave del cajero de mocoa' });
    const r = await e.autenticacion.iniciarSesion({ correo: 'cajero.mocoa@cootep.test', clave: 'clave del cajero de mocoa', ip: '1', cliente: 'web' });
    expect(r.estado).toBe('SESION_INICIADA');
    expect(e.auditoria.acciones()).toEqual(expect.arrayContaining(['USUARIO_CREADO', 'CUENTA_ACTIVADA']));
  });

  it('PR-16: un administrador no crea ni asigna fuera de su agencia y queda auditado', async () => {
    const { e, adminMocoa, funcionarioOrito } = await escenario();
    await expect(
      e.administrar.crear(adminMocoa, { email: 'x@cootep.test', nombre: 'X', rol: { rol: 'FUNCIONARIO', agenciaId: AGENCIA_ORITO } }),
    ).rejects.toBeInstanceOf(PermisoDenegadoError);
    await expect(
      e.administrar.crear(adminMocoa, { email: 'y@cootep.test', nombre: 'Y', rol: { rol: 'SUPERADMIN' } }),
    ).rejects.toMatchObject({ codigo: 'FUERA_DE_AMBITO' });
    // La ficha de un funcionario de otra agencia ni siquiera es visible: 404.
    await expect(e.administrar.actualizar(adminMocoa, funcionarioOrito.id, { activo: false })).rejects.toMatchObject({
      codigo: 'USUARIO_NO_ENCONTRADO',
    });
    expect(e.auditoria.acciones().filter((a) => a === 'INTENTO_FUERA_DE_AMBITO')).toHaveLength(2);
  });

  it('el administrador de agencia solo lista usuarios de su agencia', async () => {
    const { e, adminMocoa, superadmin } = await escenario();
    const propios = await e.administrar.listar(adminMocoa, { pagina: 1, tamano: 20 });
    expect(propios.elementos.map((u) => u.email)).toEqual(['admin.mocoa@cootep.test']);
    await expect(e.administrar.listar(adminMocoa, { agenciaId: AGENCIA_ORITO, pagina: 1, tamano: 20 })).rejects.toBeInstanceOf(
      PermisoDenegadoError,
    );
    expect((await e.administrar.listar(superadmin, { pagina: 1, tamano: 20 })).total).toBe(3);
  });

  it('entrega metadatos de paginación y conserva el total en una página vacía', async () => {
    const { e, superadmin } = await escenario();
    const predeterminada = await e.administrar.listar(superadmin, {});
    expect(predeterminada).toMatchObject({ total: 3, pagina: 1, tamano: 20, totalPaginas: 1 });

    const primera = await e.administrar.listar(superadmin, { tamano: 1 });
    const segunda = await e.administrar.listar(superadmin, { pagina: 2, tamano: 1 });
    expect(primera.elementos).toHaveLength(1);
    expect(segunda.elementos).toHaveLength(1);
    expect(primera.elementos[0].id).not.toBe(segunda.elementos[0].id);

    const fueraDeRango = await e.administrar.listar(superadmin, { pagina: 4, tamano: 1 });
    expect(fueraDeRango).toEqual({ elementos: [], total: 3, pagina: 4, tamano: 1, totalPaginas: 3 });
    const sinResultados = await e.administrar.listar(superadmin, { texto: 'nombre inexistente' });
    expect(sinResultados).toMatchObject({ elementos: [], total: 0, totalPaginas: 0 });
  });

  it('el superadministrador nombra un directivo de agencia; al desactivarlo se cierran sus sesiones', async () => {
    const { e, superadmin, funcionarioOrito } = await escenario();
    await e.administrar.asignarRol(superadmin, funcionarioOrito.id, { rol: 'ADMIN_AGENCIA', agenciaId: AGENCIA_ORITO });
    await e.sesiones.crear({ usuarioId: funcionarioOrito.id, cliente: 'web', amr: ['pwd'], creadaEn: Date.now() });

    const ficha = await e.administrar.actualizar(superadmin, funcionarioOrito.id, { activo: false });
    expect(ficha.activo).toBe(false);
    expect(e.sesiones.de(funcionarioOrito.id)).toBe(0);
    expect(e.auditoria.acciones()).toEqual(expect.arrayContaining(['ROL_ASIGNADO', 'USUARIO_DESACTIVADO']));
  });

  it('nadie se desactiva a sí mismo ni deja el sistema sin superadministrador', async () => {
    const { e, superadmin } = await escenario();
    await expect(e.administrar.actualizar(superadmin, superadmin.id, { activo: false })).rejects.toMatchObject({
      codigo: 'AUTO_BLOQUEO',
    });
    // Otro superadministrador (con un token aún vigente) intenta quitarle el rol al único activo.
    await e.usuarios.asignarRol(superadmin.id, { rol: 'ASOCIADO' });
    const rolSuper = (await e.usuarios.buscarPorId(superadmin.id))!.roles.find((r) => r.rol === 'SUPERADMIN')!;
    const otro = { id: '99999999-0000-4000-8000-000000000000', roles: [{ rol: 'SUPERADMIN' as const }] };
    await expect(e.administrar.revocarRol(otro, superadmin.id, rolSuper.id)).rejects.toMatchObject({
      codigo: 'ULTIMO_SUPERADMIN',
    });
  });

  it('no deja a una persona sin roles: se desactiva la cuenta', async () => {
    const { e, superadmin, funcionarioOrito } = await escenario();
    const unico = funcionarioOrito.roles[0];
    await expect(e.administrar.revocarRol(superadmin, funcionarioOrito.id, unico.id)).rejects.toMatchObject({ codigo: 'SIN_ROLES' });
  });
});
