/**
 * Genera un JWT de acceso para probar la API mientras el módulo de identidad está pendiente.
 * Solo funciona fuera de producción.
 *   npm run token:dev -- ASOCIADO <usuarioId>
 *   npm run token:dev -- FUNCIONARIO <usuarioId> <agenciaId> [servicioId]
 */
import { randomUUID } from 'node:crypto';
import type { AsignacionRol } from '../compartido/domain/principal';
import { firmarTokenDePrueba } from './firmar-token';

async function main(): Promise<void> {
  try {
    process.loadEnvFile();
  } catch {
    /* sin .env */
  }
  if (process.env.NODE_ENV === 'production') throw new Error('No disponible en producción');
  const secreto = process.env.JWT_SECRETO ?? '';
  if (secreto.length < 32) throw new Error('Defina JWT_SECRETO (32 caracteres o más) en .env');

  const [rol = 'ASOCIADO', usuarioId = randomUUID(), agenciaId, servicioId] = process.argv.slice(2);
  const asignacion = { rol, ...(agenciaId ? { agenciaId } : {}), ...(servicioId ? { servicioId } : {}) } as AsignacionRol;
  console.log(await firmarTokenDePrueba(secreto, usuarioId, [asignacion]));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
