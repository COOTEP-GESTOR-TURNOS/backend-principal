import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import type { PasswordHasherPort } from '../../application/ports/out/identidad.ports';

/** Argon2id con los parámetros mínimos que recomienda OWASP: 19 MiB, 2 iteraciones, paralelismo 1. */
@Injectable()
export class Argon2PasswordAdapter implements PasswordHasherPort {
  hash(clave: string): Promise<string> {
    return argon2.hash(clave, { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 });
  }

  async verificar(hash: string, clave: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, clave);
    } catch {
      return false;
    }
  }
}
