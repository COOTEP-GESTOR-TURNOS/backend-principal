import { randomBytes } from 'node:crypto';
import { AesGcmAdapter } from '../../src/identidad/infrastructure/out/seguridad/aes-gcm.adapter';
import { base32, codigoTotp, desdeBase32, hotp, TotpAdapter } from '../../src/identidad/infrastructure/out/seguridad/totp.adapter';

describe('TOTP (RFC 6238)', () => {
  // Vectores del apéndice B del RFC 6238 con SHA-1: secreto ASCII "12345678901234567890", 8 dígitos.
  const secreto = Buffer.from('12345678901234567890');
  it.each([
    [59, '94287082'],
    [1111111109, '07081804'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
  ])('en el segundo %i el código es %s', (segundos, esperado) => {
    expect(hotp(secreto, Math.floor(segundos / 30), 8)).toBe(esperado);
  });

  it('base32 ida y vuelta', () => {
    const bytes = randomBytes(20);
    expect(desdeBase32(base32(bytes)).equals(bytes)).toBe(true);
    expect(base32(Buffer.from('12345678901234567890'))).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  });

  it('acepta ±30 s de diferencia de reloj y rechaza más', () => {
    const totp = new TotpAdapter();
    const s = totp.generarSecreto();
    const ahora = new Date('2026-11-16T14:00:10Z');
    const paso = Math.floor(ahora.getTime() / 30_000);
    expect(totp.verificar(s, hotp(desdeBase32(s), paso - 1), ahora)).toBe(true);
    expect(totp.verificar(s, hotp(desdeBase32(s), paso + 1), ahora)).toBe(true);
    expect(totp.verificar(s, hotp(desdeBase32(s), paso + 2), ahora)).toBe(false);
    expect(totp.verificar(s, 'abc123', ahora)).toBe(false);
  });

  it('el comando de depuración da el código que el servidor acepta y cuánto le queda', () => {
    // Mismo vector del RFC, en 6 dígitos: los últimos 6 de 94287082.
    expect(codigoTotp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', new Date(59_000))).toEqual({ codigo: '287082', segundosRestantes: 1 });
    const totp = new TotpAdapter();
    const s = totp.generarSecreto();
    const ahora = new Date('2026-11-17T06:00:10Z');
    expect(totp.verificar(s, codigoTotp(s, ahora).codigo, ahora)).toBe(true);
    expect(codigoTotp(s, ahora).segundosRestantes).toBe(20);
  });
});

describe('Cifrado de los secretos MFA (AES-256-GCM)', () => {
  beforeAll(() => {
    process.env.CLAVE_CIFRADO_MFA = randomBytes(32).toString('base64');
  });

  it('descifra lo que cifra y cada cifrado es distinto (IV aleatorio)', () => {
    const aes = new AesGcmAdapter();
    const a = aes.cifrar('JBSWY3DPEHPK3PXP');
    expect(aes.cifrar('JBSWY3DPEHPK3PXP')).not.toBe(a);
    expect(aes.descifrar(a)).toBe('JBSWY3DPEHPK3PXP');
  });

  it('detecta un texto cifrado alterado', () => {
    const aes = new AesGcmAdapter();
    const [v, iv, tag, datos] = aes.cifrar('JBSWY3DPEHPK3PXP').split('.');
    const alterado = Buffer.from(datos, 'base64url');
    alterado[0] ^= 1;
    expect(() => aes.descifrar([v, iv, tag, alterado.toString('base64url')].join('.'))).toThrow();
  });

  it('rechaza una clave que no mide 32 bytes', () => {
    expect(() => AesGcmAdapter.leerClave(randomBytes(16).toString('base64'))).toThrow(/32 bytes/);
  });
});
