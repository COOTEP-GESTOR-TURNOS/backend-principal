/**
 * Código TOTP para depurar el inicio con MFA sin el teléfono. Solo fuera de producción.
 *
 *   npm run totp:dev -- <SECRETO_BASE32>   # al configurar MFA: el secreto que muestra la pantalla bajo el QR
 *   npm run totp:dev -- --correo <correo>  # con MFA ya configurado: lee y descifra el secreto guardado
 *
 * En Docker (el contenedor corre en producción, por eso NODE_ENV=development):
 *   docker compose -f infra/compose.apps.yml exec -e NODE_ENV=development backend-principal \
 *     node dist/cli/codigo-totp.js --correo superadmin@cootep-turno.test
 */
import { Pool } from 'pg';
import { leerConfig } from '../compartido/infrastructure/config';
import { AesGcmAdapter } from '../identidad/infrastructure/out/seguridad/aes-gcm.adapter';
import { codigoTotp } from '../identidad/infrastructure/out/seguridad/totp.adapter';

async function secretoGuardado(correo: string): Promise<string> {
  const pool = new Pool({ connectionString: leerConfig().databaseUrl, max: 1 });
  try {
    const { rows } = await pool.query<{ mfa_secreto_cifrado: string | null }>('SELECT mfa_secreto_cifrado FROM usuario WHERE email = $1', [
      correo.trim().toLowerCase(),
    ]);
    if (rows.length === 0) throw new Error(`No existe un usuario con el correo ${correo}`);
    const cifrado = rows[0].mfa_secreto_cifrado;
    if (!cifrado) throw new Error('Ese usuario aún no configuró MFA: use el secreto que muestra la pantalla de configuración');
    return new AesGcmAdapter().descifrar(cifrado);
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  try {
    process.loadEnvFile();
  } catch {
    /* sin .env: en Docker las variables vienen del compose */
  }
  if (process.env.NODE_ENV === 'production') throw new Error('No disponible en producción (use -e NODE_ENV=development)');

  const argumentos = process.argv.slice(2);
  const indiceCorreo = argumentos.indexOf('--correo');
  const secreto = indiceCorreo >= 0 ? await secretoGuardado(argumentos[indiceCorreo + 1] ?? '') : argumentos[0]?.replace(/\s+/g, '');
  if (!secreto) throw new Error('Uso: codigo-totp <SECRETO_BASE32> | --correo <correo>');

  const { codigo, segundosRestantes } = codigoTotp(secreto, new Date());
  console.log(`${codigo}  (vale ${segundosRestantes} s más; el servidor acepta también el anterior y el siguiente)`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
