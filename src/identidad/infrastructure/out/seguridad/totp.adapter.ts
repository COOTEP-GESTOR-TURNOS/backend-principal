import { Injectable } from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import * as QRCode from 'qrcode';
import type { TotpPort } from '../../../application/ports/out/seguridad.ports';

const ALFABETO_BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const PASO_SEG = 30;
const DIGITOS = 6;
/** Tolerancia de ±1 paso (30 s) por diferencias de reloj entre el teléfono y el servidor. */
const VENTANA = 1;

export function base32(bytes: Buffer): string {
  let bits = 0;
  let valor = 0;
  let salida = '';
  for (const byte of bytes) {
    valor = (valor << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      salida += ALFABETO_BASE32[(valor >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) salida += ALFABETO_BASE32[(valor << (5 - bits)) & 31];
  return salida;
}

export function desdeBase32(texto: string): Buffer {
  const limpio = texto.replace(/=+$/, '').toUpperCase();
  let bits = 0;
  let valor = 0;
  const bytes: number[] = [];
  for (const caracter of limpio) {
    const indice = ALFABETO_BASE32.indexOf(caracter);
    if (indice < 0) throw new Error('Secreto TOTP mal formado');
    valor = (valor << 5) | indice;
    bits += 5;
    if (bits >= 8) {
      bytes.push((valor >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** HOTP (RFC 4226) con HMAC-SHA1 y truncamiento dinámico. */
export function hotp(secreto: Buffer, contador: number, digitos = DIGITOS): string {
  const mensaje = Buffer.alloc(8);
  mensaje.writeBigUInt64BE(BigInt(contador));
  const hmac = createHmac('sha1', secreto).update(mensaje).digest();
  const desplazamiento = hmac[hmac.length - 1] & 0x0f;
  const binario = hmac.readUInt32BE(desplazamiento) & 0x7fffffff;
  return String(binario % 10 ** digitos).padStart(digitos, '0');
}

/** Código TOTP de un instante y los segundos que le quedan; lo usa el comando de depuración codigo-totp. */
export function codigoTotp(secreto: string, instante: Date): { codigo: string; segundosRestantes: number } {
  const segundos = Math.floor(instante.getTime() / 1000);
  return {
    codigo: hotp(desdeBase32(secreto), Math.floor(segundos / PASO_SEG)),
    segundosRestantes: PASO_SEG - (segundos % PASO_SEG),
  };
}

/**
 * TOTP (RFC 6238): HOTP con el contador = segundos desde 1970 / 30. Implementado con node:crypto
 * para no depender de librerías externas; las pruebas usan los vectores del RFC.
 */
@Injectable()
export class TotpAdapter implements TotpPort {
  generarSecreto(): string {
    return base32(randomBytes(20)); // 160 bits, lo que recomienda el RFC 4226
  }

  uriAprovisionamiento(secreto: string, cuenta: string): string {
    const emisor = 'COOTEP Turno';
    const etiqueta = encodeURIComponent(`${emisor}:${cuenta}`);
    const parametros = new URLSearchParams({
      secret: secreto,
      issuer: emisor,
      algorithm: 'SHA1',
      digits: String(DIGITOS),
      period: String(PASO_SEG),
    });
    return `otpauth://totp/${etiqueta}?${parametros.toString()}`;
  }

  qr(uri: string): Promise<string> {
    return QRCode.toDataURL(uri, { errorCorrectionLevel: 'M', margin: 2, width: 240 });
  }

  verificar(secreto: string, codigo: string, instante: Date): boolean {
    if (!/^\d{6}$/.test(codigo)) return false;
    const clave = desdeBase32(secreto);
    const paso = Math.floor(instante.getTime() / 1000 / PASO_SEG);
    const recibido = Buffer.from(codigo);
    let valido = false;
    for (let d = -VENTANA; d <= VENTANA; d++) {
      // Comparación en tiempo constante y sin cortar el ciclo: no filtra cuál paso coincidió.
      if (timingSafeEqual(Buffer.from(hotp(clave, paso + d)), recibido)) valido = true;
    }
    return valido;
  }
}
