/** Lee la configuración del entorno. Se llama al usarla para que .env ya esté cargado. */
export function leerConfig() {
  const env = process.env;
  const urlPublica = (env.URL_PUBLICA ?? 'http://localhost:8080').replace(/\/$/, '');
  return {
    produccion: env.NODE_ENV === 'production',
    puerto: Number(env.PORT ?? 3000),
    databaseUrl: env.DATABASE_URL ?? 'postgres://cootep:cootep@localhost:5432/cootep',
    redisUrl: env.REDIS_URL ?? 'redis://localhost:6379/0',
    mongoUrl: env.MONGO_URL ?? 'mongodb://localhost:27017/cootep',
    mongoDb: env.MONGO_DB ?? 'cootep',
    cassandraPuntos: (env.CASSANDRA_CONTACT_POINTS ?? 'localhost').split(','),
    cassandraDatacenter: env.CASSANDRA_DATACENTER ?? 'datacenter1',
    motorFilasUrl: env.MOTOR_FILAS_URL ?? 'http://localhost:8081',
    analiticaUrl: env.ANALITICA_URL ?? 'http://localhost:8000',
    serviceToken: env.SERVICE_TOKEN ?? '',
    jwtSecreto: env.JWT_SECRETO ?? '',
    corsOrigenes: (env.CORS_ORIGENES ?? 'http://localhost:5173').split(','),
    /** Dirección de la web: retorno de Google y enlaces de los correos. */
    urlPublica,
    cookieSegura: (env.COOKIE_SEGURA ?? 'true') !== 'false',
    claveCifradoMfa: env.CLAVE_CIFRADO_MFA ?? '',
    google: {
      clientId: env.GOOGLE_CLIENT_ID ?? '',
      clientSecret: env.GOOGLE_CLIENT_SECRET ?? '',
      redireccion: `${urlPublica}/api/v1/auth/oidc/google/callback`,
    },
    smtp: {
      host: env.SMTP_HOST ?? 'localhost',
      puerto: Number(env.SMTP_PUERTO ?? 1025),
      seguro: env.SMTP_SEGURO === 'true',
      usuario: env.SMTP_USUARIO ?? '',
      clave: env.SMTP_CLAVE ?? '',
      remitente: env.CORREO_REMITENTE ?? 'COOTEP Turno <no-responder@cootep-turno.test>',
    },
  };
}

export const TIEMPO_LIMITE_SERVICIOS_MS = 2000;
