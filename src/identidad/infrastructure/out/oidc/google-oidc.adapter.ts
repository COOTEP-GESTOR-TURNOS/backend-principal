import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { NoAutenticadoError, ServicioNoDisponibleError } from '../../../../compartido/application/errores-aplicacion';
import { leerConfig, TIEMPO_LIMITE_SERVICIOS_MS } from '../../../../compartido/infrastructure/config';
import type {
  IdentidadExterna,
  IdentityProviderPort,
  InicioAutorizacion,
  ProveedorOidc,
} from '../../../application/ports/out/identidad.ports';

const DESCUBRIMIENTO = 'https://accounts.google.com/.well-known/openid-configuration';
const EMISORES = ['https://accounts.google.com', 'accounts.google.com'];
const UNA_HORA_MS = 60 * 60 * 1000;

interface Descubrimiento {
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

const aleatorio = () => randomBytes(32).toString('base64url');

/**
 * OpenID Connect con Google: código de autorización + PKCE (S256), state y nonce.
 * El ID token se valida con las llaves públicas de Google (JWKS): firma, emisor, audiencia,
 * vencimiento y nonce. Los endpoints salen del documento de descubrimiento.
 */
@Injectable()
export class GoogleOidcAdapter implements IdentityProviderPort {
  private descubrimiento?: { datos: Descubrimiento; leidoEn: number };
  private llaves?: JWTVerifyGetKey;

  async iniciar(proveedor: ProveedorOidc): Promise<InicioAutorizacion> {
    const { clientId, redireccion } = this.configuracion(proveedor);
    const { authorization_endpoint } = await this.descubrir();
    const state = aleatorio();
    const nonce = aleatorio();
    const verificadorPkce = aleatorio();
    const desafio = createHash('sha256').update(verificadorPkce).digest('base64url');
    const parametros = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redireccion,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      nonce,
      code_challenge: desafio,
      code_challenge_method: 'S256',
      prompt: 'select_account',
    });
    return { url: `${authorization_endpoint}?${parametros.toString()}`, state, nonce, verificadorPkce };
  }

  async completar(proveedor: ProveedorOidc, codigo: string, verificadorPkce: string, nonce: string): Promise<IdentidadExterna> {
    const { clientId, clientSecret, redireccion } = this.configuracion(proveedor);
    const { token_endpoint, jwks_uri } = await this.descubrir();

    const respuesta = await fetch(token_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: codigo,
        redirect_uri: redireccion,
        client_id: clientId,
        client_secret: clientSecret,
        code_verifier: verificadorPkce,
      }),
      signal: AbortSignal.timeout(5000),
    }).catch(() => {
      throw new ServicioNoDisponibleError('Google no respondió. Intenta de nuevo');
    });
    const cuerpo = (await respuesta.json().catch(() => ({}))) as { id_token?: string; error?: string };
    if (!respuesta.ok || !cuerpo.id_token) {
      throw new NoAutenticadoError('OIDC_FALLIDO', `Google rechazó el inicio de sesión (${cuerpo.error ?? respuesta.status})`);
    }

    this.llaves ??= createRemoteJWKSet(new URL(jwks_uri));
    const { payload } = await jwtVerify(cuerpo.id_token, this.llaves, {
      issuer: EMISORES,
      audience: clientId,
      clockTolerance: 60,
    }).catch(() => {
      throw new NoAutenticadoError('ID_TOKEN_INVALIDO', 'El token de Google no es válido');
    });
    if (payload.nonce !== nonce) throw new NoAutenticadoError('ID_TOKEN_INVALIDO', 'El token de Google no corresponde a este inicio');
    if (typeof payload.sub !== 'string' || typeof payload.email !== 'string') {
      throw new NoAutenticadoError('ID_TOKEN_INVALIDO', 'Google no entregó el correo de la cuenta');
    }
    return {
      proveedor,
      sujeto: payload.sub,
      email: payload.email,
      emailVerificado: payload.email_verified === true,
      nombre: typeof payload.name === 'string' ? payload.name : '',
    };
  }

  private configuracion(proveedor: ProveedorOidc) {
    const { google } = leerConfig();
    if (proveedor !== 'google' || !google.clientId || !google.clientSecret) {
      throw new ServicioNoDisponibleError('El inicio con Google no está configurado (GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET)');
    }
    return google;
  }

  private async descubrir(): Promise<Descubrimiento> {
    if (this.descubrimiento && Date.now() - this.descubrimiento.leidoEn < UNA_HORA_MS) return this.descubrimiento.datos;
    try {
      const respuesta = await fetch(DESCUBRIMIENTO, { signal: AbortSignal.timeout(TIEMPO_LIMITE_SERVICIOS_MS * 2) });
      if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
      const datos = (await respuesta.json()) as Descubrimiento;
      this.descubrimiento = { datos, leidoEn: Date.now() };
      return datos;
    } catch {
      throw new ServicioNoDisponibleError('No se pudo contactar a Google. Revisa la conexión a internet');
    }
  }
}
