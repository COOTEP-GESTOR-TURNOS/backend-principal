import { Injectable } from '@nestjs/common';
import { ServicioNoDisponibleError } from '../../../compartido/application/errores-aplicacion';
import type {
  IdentidadExterna,
  IdentityProviderPort,
  InicioAutorizacion,
  ProveedorOidc,
} from '../../application/ports/out/identidad.ports';

/**
 * PENDIENTE (ver src/identidad/README.md): flujo de código de autorización con PKCE.
 * - Google: emisor https://accounts.google.com
 * - Microsoft: emisor https://login.microsoftonline.com/{tenant}/v2.0
 * Validar el ID token con createRemoteJWKSet y jwtVerify de la librería jose.
 */
@Injectable()
export class OidcProviderAdapter implements IdentityProviderPort {
  async iniciar(proveedor: ProveedorOidc): Promise<InicioAutorizacion> {
    throw new ServicioNoDisponibleError(`Inicio con ${proveedor} pendiente de configurar`);
  }

  async completar(proveedor: ProveedorOidc): Promise<IdentidadExterna> {
    throw new ServicioNoDisponibleError(`Inicio con ${proveedor} pendiente de configurar`);
  }
}
