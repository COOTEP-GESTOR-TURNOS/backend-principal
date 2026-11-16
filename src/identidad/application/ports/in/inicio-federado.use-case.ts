import type { ProveedorOidc } from '../out/identidad.ports';
import type { Cliente } from '../out/sesiones.port';
import type { ResultadoIngreso, SesionEmitida } from './autenticacion.use-case';

export const INICIO_FEDERADO = Symbol('INICIO_FEDERADO');

export interface ResultadoFederado {
  cliente: Cliente;
  resultado: ResultadoIngreso;
  /** Solo móvil: código de un minuto que la app canjea por sus tokens al volver del navegador. */
  codigoCanje?: string;
}

/** Puerto de entrada: inicio de sesión con OpenID Connect (código de autorización + PKCE). */
export interface InicioFederadoUseCase {
  iniciar(proveedor: ProveedorOidc, cliente: Cliente): Promise<string>;
  completar(cmd: { proveedor: ProveedorOidc; codigo: string; state: string }): Promise<ResultadoFederado>;
  canjear(codigo: string): Promise<SesionEmitida>;
}
