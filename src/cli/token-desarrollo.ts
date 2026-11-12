/**
 * Genera un JWT de acceso para probar la API mientras el módulo de identidad está pendiente.
 * Solo funciona fuera de producción.
 *   npm run token:dev -- ASOCIADO <usuarioId>
 *   npm run token:dev -- FUNCIONARIO <usuarioId> <agenciaId> [servicioId]
 */
import { randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import { AUDIENCIA_TOKENS, EMISOR_TOKENS } from '../compartido/infrastructure/auth/verificador-tokens';

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
  const asignacion = { rol, ...(agenciaId ? { agenciaId } : {}), ...(servicioId ? { servicioId } : {}) };
  const token = await new SignJWT({ roles: [asignacion] })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(usuarioId)
    .setIssuer(EMISOR_TOKENS)
    .setAudience(AUDIENCIA_TOKENS)
    .setIssuedAt()
    .setExpirationTime('8h')
    .setJti(randomUUID())
    .sign(new TextEncoder().encode(secreto));
  console.log(token);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
