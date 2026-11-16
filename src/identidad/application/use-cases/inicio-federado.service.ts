import { randomBytes } from 'node:crypto';
import { NoAutenticadoError } from '../../../compartido/application/errores-aplicacion';
import { PermisoDenegadoError, ReglaNegocioError } from '../../../compartido/domain/errores';
import { type CuentaUsuario, normalizarCorreo } from '../../domain/usuario';
import { LIMITES } from '../limites';
import type { AutenticacionUseCase, SesionEmitida } from '../ports/in/autenticacion.use-case';
import type { InicioFederadoUseCase, ResultadoFederado } from '../ports/in/inicio-federado.use-case';
import type { IdentityProviderPort, ProveedorOidc } from '../ports/out/identidad.ports';
import type { AlmacenTemporalPort, Cliente } from '../ports/out/sesiones.port';
import type { UsuarioRepository } from '../ports/out/usuario.repository';

interface EstadoOidc {
  proveedor: ProveedorOidc;
  nonce: string;
  verificadorPkce: string;
  cliente: Cliente;
}

/**
 * Inicio con Google (RF-02). El proveedor solo confirma quién es la persona: el rol sale de la
 * base de datos local. Una cuenta externa nueva se crea como asociado (CU-01).
 */
export class InicioFederadoService implements InicioFederadoUseCase {
  constructor(
    private readonly proveedor: IdentityProviderPort,
    private readonly usuarios: UsuarioRepository,
    private readonly almacen: AlmacenTemporalPort,
    private readonly autenticacion: AutenticacionUseCase,
  ) {}

  async iniciar(proveedor: ProveedorOidc, cliente: Cliente): Promise<string> {
    const inicio = await this.proveedor.iniciar(proveedor);
    const estado: EstadoOidc = { proveedor, nonce: inicio.nonce, verificadorPkce: inicio.verificadorPkce, cliente };
    await this.almacen.guardar(`oidc:estado:${inicio.state}`, estado, LIMITES.oidcEstadoSeg);
    return inicio.url;
  }

  async completar(cmd: { proveedor: ProveedorOidc; codigo: string; state: string }): Promise<ResultadoFederado> {
    // El state se consume: protege contra CSRF en el retorno y no se puede reutilizar.
    const estado = await this.almacen.consumir<EstadoOidc>(`oidc:estado:${cmd.state}`);
    if (!estado || estado.proveedor !== cmd.proveedor) {
      throw new NoAutenticadoError('ESTADO_OIDC_INVALIDO', 'El inicio con Google venció o no es válido. Intenta de nuevo');
    }
    const externa = await this.proveedor.completar(cmd.proveedor, cmd.codigo, estado.verificadorPkce, estado.nonce);
    if (!externa.emailVerificado) {
      throw new ReglaNegocioError('CORREO_EXTERNO_SIN_VERIFICAR', 'Tu cuenta de Google no tiene el correo verificado');
    }

    const cuenta = await this.buscarOCrear(externa.proveedor, externa.sujeto, normalizarCorreo(externa.email), externa.nombre);
    if (!cuenta.activo) {
      throw new PermisoDenegadoError('CUENTA_INACTIVA', 'Tu cuenta está desactivada. Comunícate con tu agencia');
    }
    const resultado = await this.autenticacion.continuar(cuenta, estado.cliente, ['fed']);

    if (estado.cliente === 'movil' && resultado.estado === 'SESION_INICIADA') {
      const codigoCanje = randomBytes(24).toString('base64url');
      await this.almacen.guardar(`oidc:canje:${codigoCanje}`, resultado.sesion, LIMITES.canjeMovilSeg);
      return { cliente: estado.cliente, resultado, codigoCanje };
    }
    return { cliente: estado.cliente, resultado };
  }

  async canjear(codigo: string): Promise<SesionEmitida> {
    const sesion = await this.almacen.consumir<SesionEmitida>(`oidc:canje:${codigo}`);
    if (!sesion) throw new NoAutenticadoError('CODIGO_CANJE_INVALIDO', 'El código venció o ya se usó');
    return sesion;
  }

  private async buscarOCrear(proveedor: ProveedorOidc, sujeto: string, email: string, nombre: string): Promise<CuentaUsuario> {
    const vinculada = await this.usuarios.buscarPorIdentidad(proveedor, sujeto);
    if (vinculada) return vinculada;

    const existente = await this.usuarios.buscarPorEmail(email);
    if (existente) {
      // Google ya probó que la persona controla el correo. Si la cuenta local no lo había verificado,
      // pudo crearla otra persona: se borra su contraseña para que nadie más conserve el acceso.
      if (!existente.emailVerificado) {
        await this.usuarios.actualizarPassword(existente.id, null, { verificarCorreo: true });
      }
      await this.usuarios.vincularIdentidad(existente.id, proveedor, sujeto);
      return (await this.usuarios.buscarPorId(existente.id))!;
    }

    return this.usuarios.crear({
      email,
      nombre: nombre.trim() || email.split('@')[0],
      emailVerificado: true,
      rol: { rol: 'ASOCIADO' },
      identidad: { proveedor, sujeto },
    });
  }
}
