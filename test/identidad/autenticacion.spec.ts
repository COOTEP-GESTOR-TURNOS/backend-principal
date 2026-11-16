import { DemasiadosIntentosError, NoAutenticadoError } from '../../src/compartido/application/errores-aplicacion';
import { PermisoDenegadoError } from '../../src/compartido/domain/errores';
import { AGENCIA_MOCOA, armarIdentidad, CLAVE_LARGA } from './escenario-identidad';

const IP = '10.0.0.7';

describe('Inicio de sesión local (RF-01, CU-01)', () => {
  it('un asociado con la clave correcta abre sesión solo con contraseña', async () => {
    const e = armarIdentidad();
    await e.crearCuenta('ana@cootep.test', { rol: 'ASOCIADO' });

    const r = await e.autenticacion.iniciarSesion({ correo: ' ANA@cootep.test ', clave: CLAVE_LARGA, ip: IP, cliente: 'web' });

    expect(r.estado).toBe('SESION_INICIADA');
    expect(e.emisor.emitidos[0].amr).toEqual(['pwd']);
  });

  it('PR-17: cinco intentos fallidos bloquean el sexto con 429, aunque la clave sea correcta', async () => {
    const e = armarIdentidad();
    await e.crearCuenta('ana@cootep.test', { rol: 'ASOCIADO' });
    for (let i = 0; i < 5; i++) {
      await expect(
        e.autenticacion.iniciarSesion({ correo: 'ana@cootep.test', clave: 'equivocada', ip: IP, cliente: 'web' }),
      ).rejects.toBeInstanceOf(NoAutenticadoError);
    }
    await expect(
      e.autenticacion.iniciarSesion({ correo: 'ana@cootep.test', clave: CLAVE_LARGA, ip: IP, cliente: 'web' }),
    ).rejects.toBeInstanceOf(DemasiadosIntentosError);
    expect(e.auditoria.acciones().filter((a) => a === 'LOGIN_FALLIDO')).toHaveLength(5);

    e.reloj.avanzar(15 * 60 + 1);
    const r = await e.autenticacion.iniciarSesion({ correo: 'ana@cootep.test', clave: CLAVE_LARGA, ip: IP, cliente: 'web' });
    expect(r.estado).toBe('SESION_INICIADA');
  });

  it('no dice si el correo existe: mismo error para cuenta inexistente y clave equivocada', async () => {
    const e = armarIdentidad();
    await e.crearCuenta('ana@cootep.test', { rol: 'ASOCIADO' });
    const inexistente = e.autenticacion.iniciarSesion({ correo: 'nadie@cootep.test', clave: 'x', ip: IP, cliente: 'web' });
    const equivocada = e.autenticacion.iniciarSesion({ correo: 'ana@cootep.test', clave: 'x', ip: IP, cliente: 'web' });
    await expect(inexistente).rejects.toThrow('Correo o contraseña incorrectos');
    await expect(equivocada).rejects.toThrow('Correo o contraseña incorrectos');
  });

  it('exige confirmar el correo antes del primer ingreso', async () => {
    const e = armarIdentidad();
    await e.crearCuenta('ana@cootep.test', { rol: 'ASOCIADO' }, { emailVerificado: false });
    await expect(
      e.autenticacion.iniciarSesion({ correo: 'ana@cootep.test', clave: CLAVE_LARGA, ip: IP, cliente: 'web' }),
    ).rejects.toMatchObject({ codigo: 'CORREO_NO_VERIFICADO' });
  });

  it('una cuenta desactivada no entra', async () => {
    const e = armarIdentidad();
    await e.crearCuenta('ana@cootep.test', { rol: 'ASOCIADO' }, { activo: false });
    await expect(
      e.autenticacion.iniciarSesion({ correo: 'ana@cootep.test', clave: CLAVE_LARGA, ip: IP, cliente: 'web' }),
    ).rejects.toBeInstanceOf(PermisoDenegadoError);
  });
});

describe('MFA para administradores (RF-03)', () => {
  it('un administrador de agencia sin MFA debe configurarlo antes de entrar', async () => {
    const e = armarIdentidad();
    const admin = await e.crearCuenta('admin@cootep.test', { rol: 'ADMIN_AGENCIA', agenciaId: AGENCIA_MOCOA });

    const paso1 = await e.autenticacion.iniciarSesion({ correo: 'admin@cootep.test', clave: CLAVE_LARGA, ip: IP, cliente: 'web' });
    expect(paso1).toMatchObject({ estado: 'PASO_PENDIENTE', paso: 'CONFIGURAR_MFA' });
    if (paso1.estado !== 'PASO_PENDIENTE') throw new Error('se esperaba un paso pendiente');

    const { secreto, uri, qr } = await e.autenticacion.prepararMfa(paso1.reto);
    expect(uri).toContain('otpauth://totp/');
    expect(qr).toMatch(/^data:image\/png;base64,/);

    const fin = await e.autenticacion.verificarMfa({ reto: paso1.reto, codigo: e.codigo(secreto), ip: IP });
    expect(fin.estado).toBe('SESION_INICIADA');
    expect(e.emisor.emitidos.at(-1)!.amr).toEqual(['pwd', 'otp']);
    expect((await e.usuarios.buscarPorId(admin.id))!.mfaSecretoCifrado).not.toBeNull();
    expect(e.auditoria.acciones()).toEqual(expect.arrayContaining(['MFA_CONFIGURADO', 'LOGIN_ADMIN']));
  });

  it('el superadministrador cambia la clave temporal y luego configura MFA', async () => {
    const e = armarIdentidad();
    await e.crearCuenta('super@cootep.test', { rol: 'SUPERADMIN' }, { debeCambiarPassword: true });

    const r1 = await e.autenticacion.iniciarSesion({ correo: 'super@cootep.test', clave: CLAVE_LARGA, ip: IP, cliente: 'web' });
    expect(r1).toMatchObject({ paso: 'CAMBIAR_CLAVE' });
    if (r1.estado !== 'PASO_PENDIENTE') throw new Error();
    await expect(e.autenticacion.cambiarClaveInicial({ reto: r1.reto, claveNueva: CLAVE_LARGA })).rejects.toMatchObject({
      codigo: 'CLAVE_REPETIDA',
    });
    const r2 = await e.autenticacion.cambiarClaveInicial({ reto: r1.reto, claveNueva: 'nueva clave del super 2026' });
    expect(r2).toMatchObject({ paso: 'CONFIGURAR_MFA' });
  });

  it('rechaza un código ya usado y anula el reto tras cinco códigos malos', async () => {
    const e = armarIdentidad();
    const secreto = e.cifrador.cifrar('JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP');
    await e.crearCuenta('admin@cootep.test', { rol: 'ADMIN_AGENCIA', agenciaId: AGENCIA_MOCOA }, { mfaSecretoCifrado: secreto });

    const login = () => e.autenticacion.iniciarSesion({ correo: 'admin@cootep.test', clave: CLAVE_LARGA, ip: IP, cliente: 'web' });
    const r1 = await login();
    if (r1.estado !== 'PASO_PENDIENTE') throw new Error();
    expect(r1.paso).toBe('VERIFICAR_MFA');
    const codigo = e.codigo('JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP');
    expect((await e.autenticacion.verificarMfa({ reto: r1.reto, codigo, ip: IP })).estado).toBe('SESION_INICIADA');

    const r2 = await login();
    if (r2.estado !== 'PASO_PENDIENTE') throw new Error();
    await expect(e.autenticacion.verificarMfa({ reto: r2.reto, codigo, ip: IP })).rejects.toMatchObject({
      codigo: 'CODIGO_MFA_INVALIDO',
    });
    for (let i = 0; i < 3; i++) {
      await expect(e.autenticacion.verificarMfa({ reto: r2.reto, codigo: '000000', ip: IP })).rejects.toBeInstanceOf(NoAutenticadoError);
    }
    await expect(e.autenticacion.verificarMfa({ reto: r2.reto, codigo: '000000', ip: IP })).rejects.toBeInstanceOf(
      DemasiadosIntentosError,
    );
    await expect(e.autenticacion.verificarMfa({ reto: r2.reto, codigo: e.codigo('JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP', 1), ip: IP })).rejects.toMatchObject({
      codigo: 'RETO_VENCIDO',
    });
  });
});

describe('Sesiones (RF-05)', () => {
  it('la renovación rota: el token anterior deja de servir', async () => {
    const e = armarIdentidad();
    await e.crearCuenta('ana@cootep.test', { rol: 'ASOCIADO' });
    const r = await e.autenticacion.iniciarSesion({ correo: 'ana@cootep.test', clave: CLAVE_LARGA, ip: IP, cliente: 'movil' });
    if (r.estado !== 'SESION_INICIADA') throw new Error();

    const nueva = await e.autenticacion.renovar(r.sesion.tokenRenovacion);
    expect(nueva.tokenRenovacion).not.toBe(r.sesion.tokenRenovacion);
    await expect(e.autenticacion.renovar(r.sesion.tokenRenovacion)).rejects.toMatchObject({ codigo: 'SESION_VENCIDA' });
  });

  it('si le asignan un rol administrativo, la sesión sin MFA no se renueva', async () => {
    const e = armarIdentidad();
    const ana = await e.crearCuenta('ana@cootep.test', { rol: 'ASOCIADO' });
    const r = await e.autenticacion.iniciarSesion({ correo: 'ana@cootep.test', clave: CLAVE_LARGA, ip: IP, cliente: 'web' });
    if (r.estado !== 'SESION_INICIADA') throw new Error();
    await e.usuarios.asignarRol(ana.id, { rol: 'ADMIN_AGENCIA', agenciaId: AGENCIA_MOCOA });

    await expect(e.autenticacion.renovar(r.sesion.tokenRenovacion)).rejects.toMatchObject({ codigo: 'REQUIERE_MFA' });
  });

  it('cerrar sesión borra la renovación y revoca el token de acceso', async () => {
    const e = armarIdentidad();
    const ana = await e.crearCuenta('ana@cootep.test', { rol: 'ASOCIADO' });
    const r = await e.autenticacion.iniciarSesion({ correo: 'ana@cootep.test', clave: CLAVE_LARGA, ip: IP, cliente: 'web' });
    if (r.estado !== 'SESION_INICIADA') throw new Error();

    const expira = Math.floor(e.reloj.ms() / 1000) + 600;
    await e.autenticacion.cerrarSesion({ tokenRenovacion: r.sesion.tokenRenovacion, acceso: { jti: 'jti-1', expira } });

    expect(e.sesiones.de(ana.id)).toBe(0);
    expect(e.sesiones.revocados.has('jti-1')).toBe(true);
  });
});
