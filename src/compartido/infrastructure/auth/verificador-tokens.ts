import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { jwtVerify } from 'jose';
import type { AsignacionRol, Principal } from '../../domain/principal';
import { leerConfig } from '../config';
import { REDIS } from '../recursos';

export const EMISOR_TOKENS = 'cootep-turno';
export const AUDIENCIA_TOKENS = 'cootep-turno-api';
/** Clave de Redis que marca un jti revocado al cerrar sesión, hasta que el token vence. */
export const claveRevocado = (jti: string) => `revocado:${jti}`;

export interface TokenVerificado {
  principal: Principal;
  jti?: string;
  /** Vencimiento en segundos desde 1970 (claim exp). */
  expira?: number;
}

/**
 * Verifica el JWT de acceso (10 min, HS256) y devuelve el usuario con sus roles.
 * Rechaza los jti revocados al cerrar sesión. Si Redis no responde se acepta el token, porque
 * vence en pocos minutos, y se deja la advertencia en el registro.
 */
@Injectable()
export class VerificadorTokens {
  private readonly logger = new Logger(VerificadorTokens.name);

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async verificar(token: string): Promise<Principal> {
    return (await this.leer(token)).principal;
  }

  async leer(token: string): Promise<TokenVerificado> {
    const clave = new TextEncoder().encode(leerConfig().jwtSecreto);
    const { payload } = await jwtVerify(token, clave, {
      algorithms: ['HS256'],
      issuer: EMISOR_TOKENS,
      audience: AUDIENCIA_TOKENS,
    });
    if (typeof payload.sub !== 'string' || !Array.isArray(payload.roles)) {
      throw new Error('El token no trae usuario ni roles');
    }
    if (payload.jti && (await this.revocado(payload.jti))) {
      throw new Error('La sesión de este token se cerró');
    }
    return {
      principal: { id: payload.sub, roles: payload.roles as AsignacionRol[] },
      jti: payload.jti,
      expira: payload.exp,
    };
  }

  private async revocado(jti: string): Promise<boolean> {
    try {
      return (await this.redis.exists(claveRevocado(jti))) === 1;
    } catch (error) {
      this.logger.warn(`No se pudo consultar la lista de tokens revocados: ${String(error)}`);
      return false;
    }
  }
}
