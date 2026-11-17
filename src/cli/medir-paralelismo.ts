/**
 * Medición de la sección 10 del informe: la consulta de mi turno con sus dos llamadas de E/S
 * (posición en el motor de filas y parámetros de espera en la analítica) en secuencia contra en
 * paralelo. Corre el caso de uso real sobre PostgreSQL, la caché del catálogo en Redis y los dos
 * servicios por HTTP; solo cambia cómo se esperan las dos llamadas.
 *
 *   node dist/cli/medir-paralelismo.js <asociadoId> [repeticiones=100] [calentamiento=10] [retardoMs=0] [hora=10:00]
 *
 * El asociado debe tener un turno activo. `retardoMs` suma esa espera a cada llamada remota para
 * simular servicios en otra red; con 0 se mide la red de Docker tal cual. `hora` fija la franja que
 * se consulta a la analítica (hoy, hora de Colombia): una franja con historial, para que la
 * analítica haga su trabajo normal aunque se mida de noche.
 */
import 'reflect-metadata';
import { cpus } from 'node:os';
import { performance } from 'node:perf_hooks';
import { setTimeout as esperar } from 'node:timers/promises';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { fechaLocal } from '../compartido/domain/tiempo';
import { type Combinar, enParalelo, enSecuencia } from '../turnos/application/combinar';
import { ESTIMADOR, type EstimadorPort } from '../turnos/application/ports/out/estimador.port';
import { MOTOR_FILAS, type MotorFilasPort } from '../turnos/application/ports/out/motor-filas.port';
import { CATALOGO, type CatalogoPort, type RelojPort } from '../turnos/application/ports/out/otros.ports';
import { TURNO_REPOSITORY, type TurnoRepository } from '../turnos/application/ports/out/turno.repository';
import { ConsultarMiTurnoService } from '../turnos/application/use-cases/consultar-mi-turno.service';
import { resumir } from './estadisticas';

type Modo = 'secuencial' | 'paralelo';
const MODOS: Record<Modo, Combinar> = { secuencial: enSecuencia, paralelo: enParalelo };

async function main(): Promise<void> {
  const [asociadoId, repeticiones = '100', calentamiento = '10', retardo = '0', hora = '10:00'] = process.argv.slice(2);
  if (!asociadoId) throw new Error('Uso: medir-paralelismo <asociadoId> [repeticiones] [calentamiento] [retardoMs]');
  const n = Number(repeticiones);
  const retardoMs = Number(retardo);
  // Solo se mide la consulta: las tareas programadas no deben correr en este proceso.
  process.env.VENCIMIENTOS_INTERVALO_SEG = '0';
  process.env.CIERRE_INTERVALO_SEG = '0';

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const motor = app.get<MotorFilasPort>(MOTOR_FILAS);
    const estimador = app.get<EstimadorPort>(ESTIMADOR);
    let midiendo = false;
    const llamadas = { motor: [] as number[], analitica: [] as number[] };
    let fallas = 0;
    const reloj: RelojPort = { ahora: () => new Date(`${fechaLocal(new Date())}T${hora}:00-05:00`) };
    // Envuelve cada llamada remota para saber cuánto tarda sola (y sumar el retardo simulado).
    const cronometrar = <T>(destino: number[], llamada: () => Promise<T>) => async () => {
      const inicio = performance.now();
      try {
        if (retardoMs > 0) await esperar(retardoMs);
        return await llamada();
      } catch (error) {
        fallas += 1; // el caso de uso la absorbe (allSettled); aquí invalida la medición
        throw error;
      } finally {
        if (midiendo) destino.push(performance.now() - inicio);
      }
    };
    const motorMedido = Object.assign(Object.create(motor) as MotorFilasPort, {
      personasDelante: (filaId: string, turnoId: string, k: number) => cronometrar(llamadas.motor, () => motor.personasDelante(filaId, turnoId, k))(),
    });
    const estimadorMedido: EstimadorPort = {
      parametros: (agenciaId, servicioId, franja) => cronometrar(llamadas.analitica, () => estimador.parametros(agenciaId, servicioId, franja))(),
    };

    const casos = Object.fromEntries(
      (Object.keys(MODOS) as Modo[]).map((modo) => [
        modo,
        new ConsultarMiTurnoService(
          app.get<TurnoRepository>(TURNO_REPOSITORY),
          app.get<CatalogoPort>(CATALOGO),
          motorMedido,
          estimadorMedido,
          reloj,
          MODOS[modo],
        ),
      ]),
    ) as Record<Modo, ConsultarMiTurnoService>;

    const tiempos: Record<Modo, number[]> = { secuencial: [], paralelo: [] };
    const una = async (modo: Modo) => {
      const inicio = performance.now();
      const turno = await casos[modo].ejecutar(asociadoId);
      const ms = performance.now() - inicio;
      // Solo cuentan las consultas completas: con una llamada fallida se mediría otra cosa.
      if (!turno) throw new Error('El asociado no tiene un turno activo');
      if (fallas > 0) throw new Error('El motor de filas o la analítica fallaron; revise que el stack esté arriba');
      return ms;
    };

    // Calentamiento: conexiones, JIT y la caché del catálogo. Luego se alterna el orden de los
    // modos en cada repetición para que ninguno se beneficie de ir primero.
    for (let i = 0; i < Number(calentamiento); i++) for (const modo of ['secuencial', 'paralelo'] as Modo[]) await una(modo);
    for (let i = 0; i < n; i++) {
      const orden: Modo[] = i % 2 === 0 ? ['secuencial', 'paralelo'] : ['paralelo', 'secuencial'];
      for (const modo of orden) {
        midiendo = true;
        tiempos[modo].push(await una(modo));
        midiendo = false;
      }
    }

    const resultado = {
      repeticiones: n,
      calentamiento: Number(calentamiento),
      retardoSimuladoMs: retardoMs,
      franja: hora,
      conEsperaEstimada: (await casos.paralelo.ejecutar(asociadoId))?.esperaEstimadaMin !== null,
      cpus: cpus().length,
      node: process.version,
      secuencial: resumir(tiempos.secuencial),
      paralelo: resumir(tiempos.paralelo),
      llamadaMotor: resumir(llamadas.motor),
      llamadaAnalitica: resumir(llamadas.analitica),
    };
    const fila = (nombre: string, r: ReturnType<typeof resumir>) =>
      `${nombre.padEnd(20)}${String(r.medianaMs).padStart(9)}${String(r.p95Ms).padStart(9)}${String(r.minimoMs).padStart(9)}${String(r.maximoMs).padStart(9)}`;
    console.log(`Consulta de mi turno · ${n} repeticiones por modo (${calentamiento} de calentamiento) · retardo simulado ${retardoMs} ms · franja ${hora}`);
    console.log(`Node ${process.version} · ${cpus().length} CPU`);
    console.log(`${'ms'.padEnd(20)}${'mediana'.padStart(9)}${'p95'.padStart(9)}${'mínimo'.padStart(9)}${'máximo'.padStart(9)}`);
    console.log(fila('secuencial', resultado.secuencial));
    console.log(fila('paralelo', resultado.paralelo));
    console.log(fila('  llamada motor', resultado.llamadaMotor));
    console.log(fila('  llamada analítica', resultado.llamadaAnalitica));
    const veces = resultado.secuencial.medianaMs / resultado.paralelo.medianaMs;
    console.log(`Mediana: ${veces.toFixed(2)} veces más rápida en paralelo (${(resultado.secuencial.medianaMs - resultado.paralelo.medianaMs).toFixed(2)} ms menos)`);
    console.log(JSON.stringify(resultado));
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
