import { randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import { AUDIENCIA_TOKENS, EMISOR_TOKENS } from '../compartido/infrastructure/auth/verificador-tokens';
import type { AsignacionRol } from '../compartido/domain/principal';

/**
 * Firma un token de acceso como los del inicio de sesión, sin pasar por él. Lo usan el comando
 * token:dev y las pruebas de integración; el servicio nunca lo llama.
 */
export function firmarTokenDePrueba(secreto: string, usuarioId: string, roles: AsignacionRol[], duracion = '8h'): Promise<string> {
  return new SignJWT({ roles })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(usuarioId)
    .setIssuer(EMISOR_TOKENS)
    .setAudience(AUDIENCIA_TOKENS)
    .setIssuedAt()
    .setExpirationTime(duracion)
    .setJti(randomUUID())
    .sign(new TextEncoder().encode(secreto));
}
