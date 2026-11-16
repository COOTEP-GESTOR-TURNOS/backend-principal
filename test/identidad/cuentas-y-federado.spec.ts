import { CLAVE_LARGA, armarIdentidad } from './escenario-identidad';

const REGISTRO = {
  email: 'Nueva.Persona@Correo.com',
  nombre: 'Nueva Persona',
  tipoDocumento: 'CC' as const,
  numeroDocumento: '1098765432',
  clave: CLAVE_LARGA,
};

describe('Registro de asociados y verificación de correo', () => {
  it('crea un asociado sin verificar, envía el enlace y al abrirlo puede ingresar', async () => {
    const e = armarIdentidad();
    const { email } = await e.cuentas.registrar(REGISTRO);
    expect(email).toBe('nueva.persona@correo.com');

    const cuenta = (await e.usuarios.buscarPorEmail(email))!;
    expect(cuenta.roles.map((r) => r.rol)).toEqual(['ASOCIADO']);
    expect(cuenta.emailVerificado).toBe(false);

    await e.cuentas.verificarCorreo(e.buzon.ultimoToken(email));
    const r = await e.autenticacion.iniciarSesion({ correo: email, clave: CLAVE_LARGA, ip: '1.1.1.1', cliente: 'web' });
    expect(r.estado).toBe('SESION_INICIADA');
  });

  it('rechaza una clave corta y un correo repetido', async () => {
    const e = armarIdentidad();
    await expect(e.cuentas.registrar({ ...REGISTRO, clave: 'corta123' })).rejects.toMatchObject({ codigo: 'CLAVE_DEBIL' });
    await e.cuentas.registrar(REGISTRO);
    await expect(e.cuentas.registrar({ ...REGISTRO, numeroDocumento: '555555' })).rejects.toMatchObject({
      codigo: 'CORREO_REGISTRADO',
    });
  });
});

describe('Recuperación de contraseña (RF-04)', () => {
  it('el enlace sirve una sola vez, cambia la clave y cierra las demás sesiones', async () => {
    const e = armarIdentidad();
    const ana = await e.crearCuenta('ana@cootep.test', { rol: 'ASOCIADO' });
    await e.autenticacion.iniciarSesion({ correo: 'ana@cootep.test', clave: CLAVE_LARGA, ip: '1.1.1.1', cliente: 'movil' });
    expect(e.sesiones.de(ana.id)).toBe(1);

    await e.cuentas.solicitarRecuperacion('ana@cootep.test');
    const token = e.buzon.ultimoToken('ana@cootep.test');
    expect(e.buzon.enviados.at(-1)!.asunto).toContain('Restablece');

    // Una clave débil no gasta el enlace.
    await expect(e.cuentas.restablecerClave({ token, claveNueva: 'corta' })).rejects.toMatchObject({ codigo: 'CLAVE_DEBIL' });
    await e.cuentas.restablecerClave({ token, claveNueva: 'otra frase larga para ana' });

    expect(e.sesiones.de(ana.id)).toBe(0);
    await expect(e.cuentas.restablecerClave({ token, claveNueva: 'otra frase larga para ana 2' })).rejects.toMatchObject({
      codigo: 'ENLACE_INVALIDO',
    });
    const r = await e.autenticacion.iniciarSesion({ correo: 'ana@cootep.test', clave: 'otra frase larga para ana', ip: '1.1.1.1', cliente: 'web' });
    expect(r.estado).toBe('SESION_INICIADA');
  });

  it('vence a los 15 minutos y solo vale el último enlace enviado', async () => {
    const e = armarIdentidad();
    await e.crearCuenta('ana@cootep.test', { rol: 'ASOCIADO' });
    await e.cuentas.solicitarRecuperacion('ana@cootep.test');
    const primero = e.buzon.ultimoToken('ana@cootep.test');
    await e.cuentas.solicitarRecuperacion('ana@cootep.test');
    const segundo = e.buzon.ultimoToken('ana@cootep.test');

    await expect(e.cuentas.restablecerClave({ token: primero, claveNueva: 'otra frase larga para ana' })).rejects.toMatchObject({
      codigo: 'ENLACE_INVALIDO',
    });
    e.reloj.avanzar(15 * 60 + 1);
    await expect(e.cuentas.restablecerClave({ token: segundo, claveNueva: 'otra frase larga para ana' })).rejects.toMatchObject({
      codigo: 'ENLACE_INVALIDO',
    });
  });

  it('con un correo que no existe no envía nada ni revela nada', async () => {
    const e = armarIdentidad();
    await expect(e.cuentas.solicitarRecuperacion('nadie@cootep.test')).resolves.toBeUndefined();
    expect(e.buzon.enviados).toHaveLength(0);
  });
});

describe('Inicio con Google (RF-02)', () => {
  it('una cuenta de Google nueva se crea como asociado sin documento', async () => {
    const e = armarIdentidad();
    await e.federado.iniciar('google', 'web');
    const { resultado } = await e.federado.completar({ proveedor: 'google', codigo: 'c', state: 'estado-1' });

    expect(resultado.estado).toBe('SESION_INICIADA');
    if (resultado.estado !== 'SESION_INICIADA') throw new Error();
    expect(resultado.sesion.usuario).toMatchObject({ email: 'persona@gmail.com', perfilCompleto: false, tienePassword: false });
    expect(resultado.sesion.usuario.roles).toEqual([{ rol: 'ASOCIADO' }]);
  });

  it('el state no se puede reutilizar', async () => {
    const e = armarIdentidad();
    await e.federado.iniciar('google', 'web');
    await e.federado.completar({ proveedor: 'google', codigo: 'c', state: 'estado-1' });
    await expect(e.federado.completar({ proveedor: 'google', codigo: 'c', state: 'estado-1' })).rejects.toMatchObject({
      codigo: 'ESTADO_OIDC_INVALIDO',
    });
  });

  it('al vincular una cuenta local sin verificar borra su contraseña (pudo crearla otra persona)', async () => {
    const e = armarIdentidad();
    const local = await e.crearCuenta('persona@gmail.com', { rol: 'ASOCIADO' }, { emailVerificado: false });
    await e.federado.iniciar('google', 'web');
    await e.federado.completar({ proveedor: 'google', codigo: 'c', state: 'estado-1' });

    const despues = (await e.usuarios.buscarPorId(local.id))!;
    expect(despues.passwordHash).toBeNull();
    expect(despues.emailVerificado).toBe(true);
    expect(await e.usuarios.buscarPorIdentidad('google', 'google-123')).toMatchObject({ id: local.id });
  });

  it('en el móvil entrega un código de un minuto que se canjea una sola vez', async () => {
    const e = armarIdentidad();
    await e.federado.iniciar('google', 'movil');
    const { codigoCanje } = await e.federado.completar({ proveedor: 'google', codigo: 'c', state: 'estado-1' });

    const sesion = await e.federado.canjear(codigoCanje!);
    expect(sesion.tokenRenovacion).toBeTruthy();
    await expect(e.federado.canjear(codigoCanje!)).rejects.toMatchObject({ codigo: 'CODIGO_CANJE_INVALIDO' });
  });
});
