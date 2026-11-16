import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import type { AsignacionRol } from '../../../../compartido/domain/principal';
import { AUDIENCIA_TOKENS, EMISOR_TOKENS } from '../../../../compartido/infrastructure/auth/verificador-tokens';
import { leerConfig } from '../../../../compartido/infrastructure/config';
import type { EmisorTokensPort, TokenAcceso } from '../../../application/ports/out/seguridad.ports';

/** 10 minutos: lo bastante corto para que un token robado sirva poco; la renovación lo reemplaza. */
export const DURACION_ACCESO_SEG = 10 * 60;

/** Firma el JWT de acceso con HS256. El mismo formato lo verifica VerificadorTokens. */
@Injectable()
export class EmisorJwtAdapter implements EmisorTokensPort {
  private readonly duracionSegundos = DURACION_ACCESO_SEG;

  async emitirAcceso(usuarioId: string, roles: AsignacionRol[], amr: string[]): Promise<TokenAcceso> {
    const jti = randomUUID();
    const token = await new SignJWT({ roles, amr })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(usuarioId)
      .setIssuer(EMISOR_TOKENS)
      .setAudience(AUDIENCIA_TOKENS)
      .setIssuedAt()
      .setExpirationTime(`${this.duracionSegundos}s`)
      .setJti(jti)
      .sign(new TextEncoder().encode(leerConfig().jwtSecreto));
    return { token, jti, expiraEn: this.duracionSegundos };
  }
}
