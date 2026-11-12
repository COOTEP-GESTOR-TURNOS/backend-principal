import { Global, Inject, Injectable, Module, OnApplicationShutdown } from '@nestjs/common';
import type { Client as ClienteCassandra } from 'cassandra-driver';
import type Redis from 'ioredis';
import type { Db, MongoClient } from 'mongodb';
import type { Pool } from 'pg';
import { CACHE } from '../application/ports/cache.port';
import { VerificadorTokens } from './auth/verificador-tokens';
import { CacheRedisAdapter } from './cache/cache-redis.adapter';
import { leerConfig } from './config';
import {
  CASSANDRA,
  crearClienteCassandra,
  crearClienteMongo,
  crearPool,
  crearRedis,
  MONGO_CLIENTE,
  MONGO_DB,
  PG_POOL,
  REDIS,
} from './recursos';

/** Cierra las conexiones al apagar el contenedor (docker compose stop). */
@Injectable()
class CierreDeRecursos implements OnApplicationShutdown {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(MONGO_CLIENTE) private readonly mongo: MongoClient,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(CASSANDRA) private readonly cassandra: ClienteCassandra,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await Promise.allSettled([this.pool.end(), this.mongo.close(), this.redis.quit(), this.cassandra.shutdown()]);
  }
}

@Global()
@Module({
  providers: [
    { provide: PG_POOL, useFactory: crearPool },
    { provide: MONGO_CLIENTE, useFactory: crearClienteMongo },
    { provide: MONGO_DB, useFactory: (cliente: MongoClient): Db => cliente.db(leerConfig().mongoDb), inject: [MONGO_CLIENTE] },
    { provide: REDIS, useFactory: crearRedis },
    { provide: CASSANDRA, useFactory: crearClienteCassandra },
    CacheRedisAdapter,
    { provide: CACHE, useExisting: CacheRedisAdapter },
    VerificadorTokens,
    CierreDeRecursos,
  ],
  exports: [PG_POOL, MONGO_DB, REDIS, CASSANDRA, CACHE, CacheRedisAdapter, VerificadorTokens],
})
export class InfraestructuraModule {}
