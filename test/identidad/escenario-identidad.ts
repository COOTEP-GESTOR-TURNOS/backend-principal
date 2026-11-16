import { AdministrarUsuariosService } from '../../src/administracion/application/use-cases/administrar-usuarios.service';
import type { AsignacionRol, Principal } from '../../src/compartido/domain/principal';
import type {
  IdentidadExterna,
  IdentityProviderPort,
  InicioAutorizacion,
} from '../../src/identidad/application/ports/out/identidad.ports';
import { AutenticacionService } from '../../src/identidad/application/use-cases/autenticacion.service';
import { CuentasService } from '../../src/identidad/application/use-cases/cuentas.service';
import { InicioFederadoService } from '../../src/identidad/application/use-cases/inicio-federado.service';
import type { CuentaUsuario } from '../../src/identidad/domain/usuario';
import {
  AlmacenEnMemoria,
  AuditoriaEnMemoria,
  BuzonEnMemoria,
  CifradorFalso,
  EmisorFalso,
  HasherFalso,
  LimitadorEnMemoria,
  RelojControlable,
  SesionesEnMemoria,
  UsuariosEnMemoria,
} from '../../src/identidad/infrastructure/out/memoria/adaptadores-en-memoria';
import { desdeBase32, hotp, TotpAdapter } from '../../src/identidad/infrastructure/out/seguridad/totp.adapter';

export const AGENCIA_MOCOA = 'a0000000-0000-4000-8000-000000000001';
export const AGENCIA_ORITO = 'a0000000-0000-4000-8000-000000000003';
export const CAJA = 'b0000000-0000-4000-8000-000000000001';
export const CLAVE_LARGA = 'una frase larga y segura 2026';

/** Proveedor OIDC falso: devuelve la identidad que la prueba le indique. */
export class ProveedorFalso implements IdentityProviderPort {
  identidad: IdentidadExterna = {
    proveedor: 'google',
    sujeto: 'google-123',
    email: 'persona@gmail.com',
    emailVerificado: true,
    nombre: 'Persona de Google',
  };
  private n = 0;
  async iniciar(): Promise<InicioAutorizacion> {
    this.n += 1;
    return { url: 'https://accounts.google.com/o/oauth2/v2/auth?x', state: `estado-${this.n}`, nonce: 'n', verificadorPkce: 'v' };
  }
  async completar(): Promise<IdentidadExterna> {
    return this.identidad;
  }
}

/** Arma los casos de uso de identidad y administración con adaptadores en memoria. */
export function armarIdentidad() {
  const reloj = new RelojControlable();
  const usuarios = new UsuariosEnMemoria();
  const hasher = new HasherFalso();
  const sesiones = new SesionesEnMemoria();
  const almacen = new AlmacenEnMemoria(reloj);
  const limitador = new LimitadorEnMemoria(reloj);
  const emisor = new EmisorFalso();
  const totp = new TotpAdapter();
  const cifrador = new CifradorFalso();
  const auditoria = new AuditoriaEnMemoria();
  const buzon = new BuzonEnMemoria();
  const proveedor = new ProveedorFalso();

  const autenticacion = new AutenticacionService(usuarios, hasher, sesiones, almacen, limitador, emisor, totp, cifrador, auditoria, reloj.ahora);
  const cuentas = new CuentasService(usuarios, hasher, sesiones, almacen, limitador, buzon, auditoria, 'http://localhost:8080');
  const federado = new InicioFederadoService(proveedor, usuarios, almacen, autenticacion);
  const administrar = new AdministrarUsuariosService(usuarios, sesiones, cuentas, auditoria);

  /** Crea una cuenta lista para ingresar (correo verificado). */
  async function crearCuenta(email: string, rol: AsignacionRol, extra: Partial<CuentaUsuario> = {}): Promise<CuentaUsuario> {
    const cuenta = await usuarios.crear({
      email,
      nombre: email.split('@')[0],
      passwordHash: await hasher.hash(CLAVE_LARGA),
      emailVerificado: true,
      rol,
    });
    Object.assign(usuarios.cuentas.get(cuenta.id)!, extra);
    return (await usuarios.buscarPorId(cuenta.id))!;
  }

  /** Código TOTP vigente para un secreto en base32. */
  function codigo(secreto: string, desplazamientoPasos = 0): string {
    return hotp(desdeBase32(secreto), Math.floor(reloj.ms() / 30_000) + desplazamientoPasos);
  }

  function principal(cuenta: CuentaUsuario): Principal {
    return { id: cuenta.id, roles: cuenta.roles.map(({ rol, agenciaId, servicioId }) => ({ rol, agenciaId, servicioId })) };
  }

  return {
    reloj, usuarios, hasher, sesiones, almacen, emisor, cifrador, auditoria, buzon, proveedor,
    autenticacion, cuentas, federado, administrar, crearCuenta, codigo, principal,
  };
}
