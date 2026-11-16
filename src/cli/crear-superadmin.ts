/**
 * Inicialización controlada del primer superadministrador (no existe registro público).
 * Lee SUPERADMIN_EMAIL y SUPERADMIN_PASSWORD_TEMPORAL; si ya hay un superadministrador, no hace nada.
 *   Docker:  docker compose -f infra/compose.apps.yml exec backend-principal node dist/cli/crear-superadmin.js
 *   Local:   npx ts-node src/cli/crear-superadmin.ts
 */
import { Pool } from 'pg';
import { leerConfig } from '../compartido/infrastructure/config';
import { PoliticaContrasena } from '../identidad/domain/politica-contrasena';
import { Argon2PasswordAdapter } from '../identidad/infrastructure/out/argon2-password.adapter';

async function main(): Promise<void> {
  try {
    process.loadEnvFile();
  } catch {
    /* sin .env */
  }
  const email = (process.env.SUPERADMIN_EMAIL ?? '').trim().toLowerCase();
  const clave = process.env.SUPERADMIN_PASSWORD_TEMPORAL ?? '';
  if (!email) throw new Error('Defina SUPERADMIN_EMAIL');
  const errores = PoliticaContrasena.validar(clave, { tieneMfa: false });
  if (errores.length > 0) throw new Error(`SUPERADMIN_PASSWORD_TEMPORAL no es válida: ${errores.join('; ')}`);

  const pool = new Pool({ connectionString: leerConfig().databaseUrl });
  const cliente = await pool.connect();
  try {
    const existente = await cliente.query("SELECT 1 FROM asignacion_rol WHERE rol = 'SUPERADMIN' LIMIT 1");
    if (existente.rowCount) {
      console.log('Ya existe un superadministrador; no se crea otro.');
      return;
    }
    const hash = await new Argon2PasswordAdapter().hash(clave);
    await cliente.query('BEGIN');
    const { rows } = await cliente.query<{ id: string }>(
      `INSERT INTO usuario (email, nombre, tipo_documento, numero_documento, password_hash,
                            debe_cambiar_password, email_verificado)
       VALUES ($1, 'Superadministrador', 'CC', '0000000000', $2, true, true) RETURNING id`,
      [email, hash],
    );
    await cliente.query("INSERT INTO asignacion_rol (usuario_id, rol) VALUES ($1, 'SUPERADMIN')", [rows[0].id]);
    await cliente.query('COMMIT');
    console.log(`Superadministrador creado: ${email}. En el primer ingreso debe cambiar la contraseña y configurar MFA.`);
  } catch (error) {
    await cliente.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    cliente.release();
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
