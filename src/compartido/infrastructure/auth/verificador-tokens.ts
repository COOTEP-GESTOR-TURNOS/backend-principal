import { Injectable } from '@nestjs/common';
import { jwtVerify } from 'jose';
import type { AsignacionRol, Principal } from '../../domain/principal';
import { leerConfig } from '../config';

export const EMISOR_TOKENS = 'cootep-turno';
export const AUDIENCIA_TOKENS = 'cootep-turno-api';

/**
 * Verifica el JWT de acceso (10 min, HS256) y devuelve el usuario con sus roles.
 * Pendiente: consultar en Redis la lista de jti revocados al cerrar sesión.
 */
@Injectable()
export class VerificadorTokens {
  async verificar(token: string): Promise<Principal> {
    const clave = new TextEncoder().encode(leerConfig().jwtSecreto);
    const { payload } = await jwtVerify(token, clave, {
      algorithms: ['HS256'],
      issuer: EMISOR_TOKENS,
      audience: AUDIENCIA_TOKENS,
    });
    if (typeof payload.sub !== 'string' || !Array.isArray(payload.roles)) {
      throw new Error('El token no trae usuario ni roles');
    }
    return { id: payload.sub, roles: payload.roles as AsignacionRol[] };
  }
}
