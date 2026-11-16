import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { leerConfig } from '../../../../compartido/infrastructure/config';
import type { CifradorPort } from '../../../application/ports/out/seguridad.ports';

const VERSION = 'v1';

/**
 * AES-256-GCM para los secretos TOTP guardados en usuario.mfa_secreto_cifrado.
 * Formato: v1.<iv>.<etiqueta>.<cifrado> en base64url. GCM detecta cualquier alteración.
 */
@Injectable()
export class AesGcmAdapter implements CifradorPort {
  private readonly clave: Buffer;

  constructor() {
    this.clave = AesGcmAdapter.leerClave(leerConfig().claveCifradoMfa);
  }

  static leerClave(base64: string): Buffer {
    const clave = Buffer.from(base64, 'base64');
    if (clave.length !== 32) {
      throw new Error('CLAVE_CIFRADO_MFA debe ser de 32 bytes en base64 (vea infra/.env.example)');
    }
    return clave;
  }

  cifrar(texto: string): string {
    const iv = randomBytes(12);
    const cifrador = createCipheriv('aes-256-gcm', this.clave, iv);
    const cifrado = Buffer.concat([cifrador.update(texto, 'utf8'), cifrador.final()]);
    return [VERSION, iv, cifrador.getAuthTag(), cifrado].map((p) => (typeof p === 'string' ? p : p.toString('base64url'))).join('.');
  }

  descifrar(valor: string): string {
    const [version, iv, etiqueta, cifrado] = valor.split('.');
    if (version !== VERSION || !iv || !etiqueta || !cifrado) throw new Error('Secreto cifrado con formato desconocido');
    const descifrador = createDecipheriv('aes-256-gcm', this.clave, Buffer.from(iv, 'base64url'));
    descifrador.setAuthTag(Buffer.from(etiqueta, 'base64url'));
    return Buffer.concat([descifrador.update(Buffer.from(cifrado, 'base64url')), descifrador.final()]).toString('utf8');
  }
}
