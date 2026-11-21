import 'reflect-metadata';
import { parseArgs } from 'node:util';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { Db } from 'mongodb';
import type { Pool } from 'pg';
import { prepararEventosDemo } from '../compartido/infrastructure/demo-mongo';
import { InfraestructuraModule } from '../compartido/infrastructure/infraestructura.module';
import { MONGO_DB, PG_POOL } from '../compartido/infrastructure/recursos';
import { SOLICITAR_TURNO, type SolicitarTurnoUseCase } from '../turnos/application/ports/in/solicitar-turno.use-case';
import { CATALOGO, JORNADAS, type CatalogoPort, type JornadasPort } from '../turnos/application/ports/out/otros.ports';
import { TURNO_REPOSITORY, type TurnoRepository } from '../turnos/application/ports/out/turno.repository';
import { TurnosModule } from '../turnos/turnos.module';
import { asignarCorreoDemo, generarCuentas } from './demo-cuentas';
import { dejarPendientes, importarHistorial, type EntradaPendientes } from './demo-turnos';

@Module({ imports: [InfraestructuraModule, TurnosModule] })
class DemoCliModule {}

const AYUDA = `Uso interno del comando demo.ps1:
  demo.js cuentas --semilla 7
  demo.js importar                       # leer el historial JSONL de stdin
  demo.js pendientes --lote inicial      # leer las agencias elegibles de stdin
  demo.js activar-usuario --id UUID-o-correo-demo --correo persona@ejemplo.com`;

async function leerPendientes(): Promise<EntradaPendientes> {
  process.stdin.setEncoding('utf8');
  let entrada = '';
  for await (const fragmento of process.stdin) entrada += fragmento;
  return JSON.parse(entrada) as EntradaPendientes;
}

async function main() {
  const { positionals, values } = parseArgs({
    options: {
      semilla: { type: 'string', default: '7' },
      lote: { type: 'string', default: 'inicial' },
      id: { type: 'string' }, correo: { type: 'string' }, help: { type: 'boolean' },
    },
    allowPositionals: true,
  });
  if (values.help) {
    console.log(AYUDA);
    return;
  }
  const [accion] = positionals;
  if (positionals.length !== 1 || !['cuentas', 'importar', 'pendientes', 'activar-usuario'].includes(accion)) {
    throw new Error(AYUDA);
  }
  const semilla = Number(values.semilla);
  if (accion === 'cuentas' && (!/^-?[0-9]+$/.test(values.semilla) || !Number.isInteger(semilla) ||
      semilla < -2_147_483_648 || semilla > 2_147_483_647)) throw new Error('La semilla debe ser un entero de 32 bits.');
  if (accion === 'pendientes' && !/^[A-Za-z0-9_-]{1,64}$/.test(values.lote)) throw new Error('Identificador de lote inválido.');
  if (accion === 'activar-usuario' && (!values.id || !values.correo)) throw new Error('Indica --id y --correo.');

  try { process.loadEnvFile(); } catch { /* El contenedor ya proporciona el entorno. */ }
  // El servidor HTTP sigue siendo el único dueño de las tareas periódicas del turnero.
  process.env.VENCIMIENTOS_INTERVALO_SEG = '0';
  process.env.CIERRE_INTERVALO_SEG = '0';
  const app = await NestFactory.createApplicationContext(DemoCliModule, { logger: false, abortOnError: false });
  try {
    const pool = app.get<Pool>(PG_POOL);
    if (accion === 'activar-usuario') {
      console.log(JSON.stringify(await asignarCorreoDemo(pool, values.id!, values.correo!)));
      return;
    }
    const db = app.get<Db>(MONGO_DB);
    await prepararEventosDemo(db);
    if (accion === 'cuentas') {
      console.log(JSON.stringify(await generarCuentas(pool, db, app.get<CatalogoPort>(CATALOGO), semilla)));
      return;
    }
    if (accion === 'importar') {
      console.log(JSON.stringify(await importarHistorial(pool, db, process.stdin)));
      return;
    }
    console.log(JSON.stringify(await dejarPendientes(pool, db, app.get<CatalogoPort>(CATALOGO), app.get<JornadasPort>(JORNADAS),
      app.get<TurnoRepository>(TURNO_REPOSITORY), app.get<SolicitarTurnoUseCase>(SOLICITAR_TURNO),
      await leerPendientes(), values.lote)));
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
