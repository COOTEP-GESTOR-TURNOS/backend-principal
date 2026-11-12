import { Client as ClienteCassandra } from 'cassandra-driver';
import Redis from 'ioredis';
import { MongoClient } from 'mongodb';
import { Pool, types } from 'pg';
import { leerConfig } from './config';

export const PG_POOL = Symbol('PG_POOL');
export const MONGO_CLIENTE = Symbol('MONGO_CLIENTE');
export const MONGO_DB = Symbol('MONGO_DB');
export const REDIS = Symbol('REDIS');
export const CASSANDRA = Symbol('CASSANDRA');

// Las columnas DATE se leen como texto AAAA-MM-DD para no mezclar zonas horarias.
types.setTypeParser(1082, (valor: string) => valor);

/** Todas las conexiones son perezosas: el servicio arranca aunque un motor tarde en estar listo. */
export function crearPool(): Pool {
  return new Pool({ connectionString: leerConfig().databaseUrl, max: 10, connectionTimeoutMillis: 2000 });
}

export function crearClienteMongo(): MongoClient {
  return new MongoClient(leerConfig().mongoUrl, { serverSelectionTimeoutMS: 2000 });
}

export function crearRedis(): Redis {
  return new Redis(leerConfig().redisUrl, { lazyConnect: true, maxRetriesPerRequest: 2 });
}

export function crearClienteCassandra(): ClienteCassandra {
  const config = leerConfig();
  return new ClienteCassandra({
    contactPoints: config.cassandraPuntos,
    localDataCenter: config.cassandraDatacenter,
    keyspace: 'cootep',
  });
}
