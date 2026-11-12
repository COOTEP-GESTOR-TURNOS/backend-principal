/**
 * Crea usuarios ficticios para la demostración (solo fuera de producción):
 * dos asociados (uno adulto mayor), un funcionario y un administrador de la Agencia Mocoa.
 * Las contraseñas se generan al azar y se muestran una sola vez.
 *   npm run demo:sembrar
 */
import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { leerConfig } from '../compartido/infrastructure/config';
import { Argon2PasswordAdapter } from '../identidad/infrastructure/out/argon2-password.adapter';

const AGENCIA_MOCOA = 'a0000000-0000-4000-8000-000000000001';

const USUARIOS = [
  { email: 'asociado.demo@cootep-turno.test', nombre: 'Asociado de prueba', documento: '1000000001', nacimiento: '1990-05-01', rol: 'ASOCIADO', agencia: null },
  { email: 'adulto.mayor@cootep-turno.test', nombre: 'Adulta mayor de prueba', documento: '1000000002', nacimiento: '1950-03-10', rol: 'ASOCIADO', agencia: null },
  { email: 'funcionario.mocoa@cootep-turno.test', nombre: 'Funcionario Mocoa', documento: '1000000003', nacimiento: null, rol: 'FUNCIONARIO', agencia: AGENCIA_MOCOA },
  { email: 'admin.mocoa@cootep-turno.test', nombre: 'Administradora Mocoa', documento: '1000000004', nacimiento: null, rol: 'ADMIN_AGENCIA', agencia: AGENCIA_MOCOA },
] as const;

async function main(): Promise<void> {
  try {
    process.loadEnvFile();
  } catch {
    /* sin .env */
  }
  if (process.env.NODE_ENV === 'production') throw new Error('No se siembran datos de demostración en producción');

  const hasher = new Argon2PasswordAdapter();
  const pool = new Pool({ connectionString: leerConfig().databaseUrl });
  try {
    for (const u of USUARIOS) {
      const clave = randomBytes(15).toString('base64url'); // 20 caracteres
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO usuario (email, nombre, tipo_documento, numero_documento, fecha_nacimiento, password_hash)
         VALUES ($1, $2, 'CC', $3, $4, $5)
         ON CONFLICT (email) DO NOTHING RETURNING id`,
        [u.email, u.nombre, u.documento, u.nacimiento, await hasher.hash(clave)],
      );
      if (rows.length === 0) {
        console.log(`${u.email}: ya existía, no se cambia`);
        continue;
      }
      await pool.query('INSERT INTO asignacion_rol (usuario_id, rol, agencia_id) VALUES ($1, $2, $3)', [
        rows[0].id,
        u.rol,
        u.agencia,
      ]);
      console.log(`${u.rol.padEnd(14)} ${u.email}  id=${rows[0].id}  clave=${clave}`);
    }
    console.log('\nToken de prueba: npm run token:dev -- <ROL> <id> [agenciaId] [servicioId]');
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
