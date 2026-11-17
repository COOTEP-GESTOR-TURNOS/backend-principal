import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { AppModule } from '../../src/app.module';
import { AUDIT_LOG } from '../../src/auditoria/application/ports/out/audit-log.port';
import { firmarTokenDePrueba } from '../../src/cli/firmar-token';
import type { AsignacionRol } from '../../src/compartido/domain/principal';
import { configurarApp } from '../../src/configurar-app';
import { AuditoriaEnMemoria } from '../../src/identidad/infrastructure/out/memoria/adaptadores-en-memoria';
import { MOTOR_FILAS } from '../../src/turnos/application/ports/out/motor-filas.port';
import { EVENT_STORE, NOTIFICADOR, RELOJ } from '../../src/turnos/application/ports/out/otros.ports';
import {
  EventStoreEnMemoria,
  MotorFilasEnMemoria,
  NotificadorEnMemoria,
  RelojFijo,
} from '../../src/turnos/infrastructure/out/memoria/adaptadores-en-memoria';

/** Las mismas imágenes de infra/compose.datos.yml: así se prueba contra lo que se despliega. */
const IMAGEN_POSTGRES = 'postgres:17.2-alpine';
const IMAGEN_REDIS = 'redis:7.4.1-alpine';

export const MOCOA = 'a0000000-0000-4000-8000-000000000001';
export const CAJA = 'b0000000-0000-4000-8000-000000000001';
/** Miércoles 18 de noviembre de 2026, 10:00 en Colombia: la agencia está en horario. */
const AHORA = new Date('2026-11-18T15:00:00Z');

/**
 * El esquema vive en el repositorio paraguas (cootep-turno/infra/init/postgres). Se busca junto a
 * este repositorio o, cuando backend-principal es un submódulo, un nivel arriba.
 */
function carpetaEsquema(): string {
  const candidatas = [process.env.ESQUEMA_POSTGRES, '../cootep-turno/infra/init/postgres', '../infra/init/postgres']
    .filter((c): c is string => Boolean(c))
    .map((c) => resolve(__dirname, '../..', c));
  const encontrada = candidatas.find((c) => existsSync(resolve(c, '01-esquema.sql')));
  if (!encontrada) throw new Error(`No encontré el esquema de PostgreSQL; defina ESQUEMA_POSTGRES. Busqué en: ${candidatas.join(', ')}`);
  return encontrada;
}

export interface Respuesta<T = Record<string, unknown>> {
  status: number;
  cuerpo: T;
}

export interface Persona {
  id: string;
  token: string;
}

export interface Entorno {
  url: string;
  pool: Pool;
  pedir<T = Record<string, unknown>>(metodo: string, ruta: string, opciones?: { token?: string; cuerpo?: unknown; cabeceras?: Record<string, string> }): Promise<Respuesta<T>>;
  crearPersona(nombre: string, roles?: AsignacionRol[]): Promise<Persona>;
  cerrar(): Promise<void>;
}

/**
 * Levanta PostgreSQL y Redis en contenedores (Testcontainers) y el backend principal real sobre
 * ellos: HTTP, JWT, guardas, validación, casos de uso y repositorios de PostgreSQL. Solo se
 * reemplazan el motor de filas (tiene sus propias pruebas con Testcontainers en JUnit), MongoDB,
 * Cassandra y Socket.IO, que no deciden nada en PR-14 ni en PR-15.
 */
export async function levantarEntorno(): Promise<Entorno> {
  const [postgres, redis] = await arrancarContenedores();

  const secreto = randomBytes(32).toString('hex');
  const databaseUrl = `postgres://cootep:cootep@${postgres.getHost()}:${postgres.getMappedPort(5432)}/cootep`;
  Object.assign(process.env, {
    NODE_ENV: 'test',
    DATABASE_URL: databaseUrl,
    REDIS_URL: `redis://${redis.getHost()}:${redis.getMappedPort(6379)}/0`,
    JWT_SECRETO: secreto,
    CLAVE_CIFRADO_MFA: randomBytes(32).toString('base64'),
    // Nada debe llegar por accidente al entorno de desarrollo que corre en el mismo equipo.
    MONGO_URL: 'mongodb://127.0.0.1:1/cootep',
    CASSANDRA_CONTACT_POINTS: '127.0.0.1:1',
    MOTOR_FILAS_URL: 'http://127.0.0.1:1',
    ANALITICA_URL: 'http://127.0.0.1:1',
    VENCIMIENTOS_INTERVALO_SEG: '0',
    CIERRE_INTERVALO_SEG: '0',
  });

  const modulo = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MOTOR_FILAS)
    .useValue(new MotorFilasEnMemoria())
    .overrideProvider(EVENT_STORE)
    .useValue(new EventStoreEnMemoria())
    .overrideProvider(NOTIFICADOR)
    .useValue(new NotificadorEnMemoria())
    .overrideProvider(AUDIT_LOG)
    .useValue(new AuditoriaEnMemoria())
    .overrideProvider(RELOJ)
    .useValue(new RelojFijo(AHORA))
    .compile();
  const app = configurarApp(modulo.createNestApplication<NestExpressApplication>({ logger: ['error'] }));
  await app.listen(0, '127.0.0.1');
  const url = `${(await app.getUrl()).replace('[::1]', '127.0.0.1')}/api/v1`;
  const pool = new Pool({ connectionString: databaseUrl, max: 4 });

  return {
    url,
    pool,
    async pedir(metodo, ruta, { token, cuerpo, cabeceras } = {}) {
      const r = await fetch(url + ruta, {
        method: metodo,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(cuerpo !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...cabeceras,
        },
        body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
      });
      const texto = await r.text();
      return { status: r.status, cuerpo: texto ? JSON.parse(texto) : null };
    },
    async crearPersona(nombre, roles = [{ rol: 'ASOCIADO' }]) {
      const id = randomUUID();
      // turno.asociado_id referencia a usuario: la persona debe existir en PostgreSQL.
      await pool.query('INSERT INTO usuario (id, email, nombre, email_verificado) VALUES ($1, $2, $3, true)', [id, `${id}@pruebas.test`, nombre]);
      return { id, token: await firmarTokenDePrueba(secreto, id, roles, '10m') };
    },
    async cerrar() {
      await pool.end();
      await app.close();
      await Promise.allSettled([postgres.stop(), redis.stop()]);
    },
  };
}

async function arrancarContenedores(): Promise<[StartedTestContainer, StartedTestContainer]> {
  const arranques = await Promise.allSettled([
    new GenericContainer(IMAGEN_POSTGRES)
      .withEnvironment({ POSTGRES_DB: 'cootep', POSTGRES_USER: 'cootep', POSTGRES_PASSWORD: 'cootep' })
      .withCopyDirectoriesToContainer([{ source: carpetaEsquema(), target: '/docker-entrypoint-initdb.d' }])
      .withExposedPorts(5432)
      // El primer "ready" es el servidor temporal que corre los scripts; el segundo, el definitivo.
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .start(),
    new GenericContainer(IMAGEN_REDIS).withExposedPorts(6379).withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/)).start(),
  ]);
  const [postgres, redis] = arranques;
  if (postgres.status === 'fulfilled' && redis.status === 'fulfilled') return [postgres.value, redis.value];
  await Promise.allSettled(arranques.map((a) => (a.status === 'fulfilled' ? a.value.stop() : undefined)));
  const motivo = [postgres, redis].find((a): a is PromiseRejectedResult => a.status === 'rejected')!.reason;
  throw new Error(`Las pruebas de integración necesitan Docker en marcha (Docker Desktop). ${String(motivo)}`);
}

/** Cabecera de idempotencia nueva para cada solicitud de turno. */
export const nuevaClave = () => ({ 'Idempotency-Key': randomUUID() });
