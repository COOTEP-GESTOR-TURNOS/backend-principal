import { GestionarAgenciasService, vistaParametros } from '../../src/administracion/application/use-cases/gestionar-agencias.service';
import { PoliticaParametros } from '../../src/administracion/domain/parametros';
import { AgenciasEnMemoria, InvalidadorEnMemoria } from '../../src/administracion/infrastructure/out/memoria/agencias-en-memoria';
import { NoEncontradoError, PermisoDenegadoError, ReglaNegocioError } from '../../src/compartido/domain/errores';
import type { Principal } from '../../src/compartido/domain/principal';
import { AuditoriaEnMemoria } from '../../src/identidad/infrastructure/out/memoria/adaptadores-en-memoria';

const MOCOA = 'a0000000-0000-4000-8000-000000000001';
const ORITO = 'a0000000-0000-4000-8000-000000000003';
const CAJA = 'b0000000-0000-4000-8000-000000000001';

const superadmin: Principal = { id: 's', roles: [{ rol: 'SUPERADMIN' }] };
const directivoMocoa: Principal = { id: 'd', roles: [{ rol: 'ADMIN_AGENCIA', agenciaId: MOCOA }] };

const agencia = (id: string, nombre: string) => ({
  id,
  codigo: nombre.slice(0, 4).toUpperCase(),
  nombre,
  municipio: nombre,
  activa: true,
  servicios: [{ servicioId: CAJA, codigo: 'CAJA', nombre: 'Caja', prefijo: 'C', ventanillas: 3, activo: true }],
  parametros: {},
});

function armar() {
  const repo = new AgenciasEnMemoria([agencia(MOCOA, 'Agencia Mocoa'), agencia(ORITO, 'Agencia Orito')]);
  repo.globales = { HORARIO_APERTURA: '08:00', HORARIO_CIERRE: '16:00', N_PROXIMO: '3' };
  const invalidador = new InvalidadorEnMemoria();
  const auditoria = new AuditoriaEnMemoria();
  return { servicio: new GestionarAgenciasService(repo, invalidador, auditoria), repo, invalidador, auditoria };
}

describe('Parámetros de la agencia (dominio)', () => {
  it('valida rangos, horas en punto o y media y el ámbito global de la edad', () => {
    expect(PoliticaParametros.validarValor('N_PROXIMO', ' 5 ')).toBe('5');
    expect(() => PoliticaParametros.validarValor('N_PROXIMO', '0')).toThrow(/entre 1 y 20/);
    expect(() => PoliticaParametros.validarValor('MAX_PREFERENCIALES_SEGUIDOS', '2.5')).toThrow(ReglaNegocioError);
    expect(PoliticaParametros.validarValor('HORARIO_APERTURA', '07:30')).toBe('07:30');
    expect(() => PoliticaParametros.validarValor('HORARIO_APERTURA', '07:15')).toThrow(/en punto o y media/);
    expect(() => PoliticaParametros.validarAmbito('EDAD_ADULTO_MAYOR', MOCOA)).toThrow(/todas las agencias/);
    expect(() => PoliticaParametros.validarValor('NO_EXISTE', '1')).toThrow(/No existe/);
    expect(() => PoliticaParametros.validarVentanillas(21)).toThrow(/de 1 a 20/);
  });

  it('el valor efectivo es el de la agencia, si no el global y si no el de fábrica', () => {
    const v = vistaParametros({ N_PROXIMO: '4' }, { HORARIO_CIERRE: '17:00' });
    const de = (c: string) => v.find((p) => p.clave === c)!;
    expect(de('HORARIO_CIERRE')).toMatchObject({ valor: '17:00', origen: 'AGENCIA' });
    expect(de('N_PROXIMO')).toMatchObject({ valor: '4', origen: 'GLOBAL' });
    expect(de('T_LLAMADO_MIN')).toMatchObject({ valor: '3', origen: 'POR_DEFECTO' });
    expect(de('EDAD_ADULTO_MAYOR').editableEnAgencia).toBe(false);
  });
});

describe('RF-17, CU-05: gestión de la agencia', () => {
  it('el directivo cambia las ventanillas de su agencia: se invalida la caché y se audita el antes y el después', async () => {
    const { servicio, invalidador, auditoria } = armar();
    const vista = await servicio.actualizarServicio(directivoMocoa, MOCOA, CAJA, { ventanillas: 5 }, '10.0.0.1');
    expect(vista.servicios[0].ventanillas).toBe(5);
    expect(invalidador.invalidadas).toEqual([MOCOA]);
    expect(auditoria.entradas).toMatchObject([
      { accion: 'SERVICIO_ACTUALIZADO', ambito: MOCOA, detalle: { antes: { ventanillas: 3, activo: true }, despues: { ventanillas: 5 } } },
    ]);
  });

  it('PR-16: no administra otra agencia; el intento queda auditado', async () => {
    const { servicio, auditoria, invalidador } = armar();
    await expect(servicio.actualizarServicio(directivoMocoa, ORITO, CAJA, { ventanillas: 1 })).rejects.toBeInstanceOf(PermisoDenegadoError);
    await expect(servicio.obtener(directivoMocoa, ORITO)).rejects.toBeInstanceOf(PermisoDenegadoError);
    expect(auditoria.acciones()).toEqual(['INTENTO_FUERA_DE_AMBITO', 'INTENTO_FUERA_DE_AMBITO']);
    expect(invalidador.invalidadas).toEqual([]);
  });

  it('cambia el horario solo si la apertura queda antes del cierre', async () => {
    const { servicio } = armar();
    await expect(servicio.fijarParametro(directivoMocoa, MOCOA, 'HORARIO_CIERRE', '07:00')).rejects.toMatchObject({ codigo: 'HORARIO_INVALIDO' });
    const vista = await servicio.fijarParametro(directivoMocoa, MOCOA, 'HORARIO_CIERRE', '17:30');
    expect(vista.parametros.find((p) => p.clave === 'HORARIO_CIERRE')).toMatchObject({ valor: '17:30', origen: 'AGENCIA' });
  });

  it('la edad de adulto mayor no se cambia por agencia', async () => {
    const { servicio } = armar();
    await expect(servicio.fijarParametro(superadmin, MOCOA, 'EDAD_ADULTO_MAYOR', '62')).rejects.toMatchObject({ codigo: 'PARAMETRO_GLOBAL' });
  });

  it('restablecer un parámetro vuelve al valor global', async () => {
    const { servicio, auditoria } = armar();
    await servicio.fijarParametro(directivoMocoa, MOCOA, 'N_PROXIMO', '6');
    const vista = await servicio.restablecerParametro(directivoMocoa, MOCOA, 'N_PROXIMO');
    expect(vista.parametros.find((p) => p.clave === 'N_PROXIMO')).toMatchObject({ valor: '3', origen: 'GLOBAL' });
    expect(auditoria.acciones()).toEqual(['PARAMETRO_CAMBIADO', 'PARAMETRO_RESTABLECIDO']);
  });

  it('solo el superadministrador cambia parámetros globales y cierra agencias', async () => {
    const { servicio, invalidador, auditoria } = armar();
    await expect(servicio.fijarParametroGlobal(directivoMocoa, 'EDAD_ADULTO_MAYOR', '62')).rejects.toBeInstanceOf(PermisoDenegadoError);
    await expect(servicio.actualizarAgencia(directivoMocoa, MOCOA, { activa: false })).rejects.toBeInstanceOf(PermisoDenegadoError);

    const globales = await servicio.fijarParametroGlobal(superadmin, 'EDAD_ADULTO_MAYOR', '62');
    expect(globales.find((p) => p.clave === 'EDAD_ADULTO_MAYOR')).toMatchObject({ valor: '62', origen: 'GLOBAL' });
    expect(invalidador.invalidadas).toContain('*');

    const vista = await servicio.actualizarAgencia(superadmin, MOCOA, { activa: false });
    expect(vista.activa).toBe(false);
    expect(auditoria.acciones()).toEqual(expect.arrayContaining(['PARAMETRO_CAMBIADO', 'AGENCIA_DESACTIVADA']));
  });

  it('un servicio que la agencia no tiene es 404', async () => {
    const { servicio } = armar();
    await expect(servicio.actualizarServicio(superadmin, MOCOA, 'b0000000-0000-4000-8000-000000000009', { activo: false })).rejects.toBeInstanceOf(NoEncontradoError);
  });
});
