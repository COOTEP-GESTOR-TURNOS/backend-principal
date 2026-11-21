import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';
import { isUUID } from 'class-validator';
import type { Db } from 'mongodb';
import type { Pool } from 'pg';
import { ErrorDeDominio } from '../compartido/domain/errores';
import { fechaLocal } from '../compartido/domain/tiempo';
import { EVENTOS_TURNO_DEMO } from '../compartido/infrastructure/demo-mongo';
import type { SolicitarTurnoUseCase } from '../turnos/application/ports/in/solicitar-turno.use-case';
import type { CatalogoPort, JornadasPort, RelojPort } from '../turnos/application/ports/out/otros.ports';
import type { TurnoRepository } from '../turnos/application/ports/out/turno.repository';
import type { ResumenTurno } from '../turnos/application/resumen-turno';
import { EstadoTurno, ESTADOS_ACTIVOS, nombreEvento } from '../turnos/domain/estado-turno';
import type { EventoTurnoPublicable } from '../turnos/domain/evento-turno';
import type { DatosTurno } from '../turnos/domain/turno';
import { claveDemo, enTransaccion } from './demo-cuentas';

type FechaTurno = 'solicitadoEn' | 'proximoEn' | 'confirmadoEn' | 'llamadoEn' | 'inicioAtencionEn' | 'finEn';
type TurnoEntrada = Omit<DatosTurno, FechaTurno | 'version'> & Record<FechaTurno, string | null>;
type EventoEntrada = Omit<EventoTurnoPublicable, 'ocurridoEn'> & { ocurridoEn: string };
interface RegistroDemo { turno: TurnoEntrada; eventos: EventoEntrada[] }

interface GrupoPendientes {
  agenciaId: string;
  servicioId: string;
  asociados: string[];
}

export interface EntradaPendientes {
  fecha: string;
  agencias: GrupoPendientes[];
}

interface ReservaPendiente {
  ordinal: number;
  asociado_id: string;
  servicio_id: string;
}

const TERMINALES = new Set([EstadoTurno.ATENDIDO, EstadoTurno.AUSENTE, EstadoTurno.CANCELADO]);
const TAMANO_LOTE = 500;

function leerRegistro(linea: string, hoy: string): RegistroDemo {
  const registro = JSON.parse(linea) as RegistroDemo;
  const turno = registro.turno;
  const eventos = registro.eventos;
  if (!turno || ![turno.id, turno.agenciaId, turno.servicioId, turno.asociadoId].every((id) => isUUID(id)) ||
      !turno.solicitadoEn || !Number.isFinite(Date.parse(turno.solicitadoEn)) ||
      fechaLocal(new Date(turno.solicitadoEn)) !== turno.fecha || turno.fecha >= hoy ||
      !TERMINALES.has(turno.estado) || !Array.isArray(eventos) ||
      eventos.filter((evento) => evento.estadoNuevo === EstadoTurno.SOLICITADO).length !== 1 ||
      eventos.at(-1)?.estadoNuevo !== turno.estado ||
      eventos.some((evento) => !evento.eventoId || !Number.isFinite(Date.parse(evento.ocurridoEn)) ||
        evento.turnoId !== turno.id || evento.agenciaId !== turno.agenciaId || evento.servicioId !== turno.servicioId ||
        evento.asociadoId !== turno.asociadoId)) {
    throw new Error('El historial requiere turnos demo finalizados de días anteriores y sus eventos de solicitud y atención.');
  }
  return registro;
}

async function guardarLote(pool: Pool, db: Db, lote: RegistroDemo[]): Promise<{ turnos: number; eventos: number }> {
  const turnos = JSON.stringify(lote.map((registro) => registro.turno));
  const codigos = await enTransaccion(pool, async (cliente) => {
    const creados = await cliente.query(
      `WITH entrada AS (
           SELECT x.* FROM jsonb_to_recordset($1::jsonb) AS x(
             id uuid, "agenciaId" uuid, "servicioId" uuid, "asociadoId" uuid, fecha date, numero integer,
             "tipoAtencion" text, estado text, canal text, motivo text, "solicitadoEn" timestamptz,
             "proximoEn" timestamptz, "confirmadoEn" timestamptz, "llamadoEn" timestamptz,
             "inicioAtencionEn" timestamptz, "finEn" timestamptz, "atendidoPor" uuid, "verificadoPor" uuid)
      ), nuevos AS (
           SELECT e.*, s.prefijo_turno
             FROM entrada e
             JOIN demo_participante p ON p.usuario_id = e."asociadoId" AND p.rol = 'ASOCIADO' AND p.agencia_id = e."agenciaId"
             JOIN servicio s ON s.id = e."servicioId"
            WHERE NOT EXISTS (SELECT 1 FROM turno t WHERE t.id = e.id)
      ), numerados AS (
           SELECT n.*, coalesce(anteriores.maximo, 0) + row_number() OVER (
                     PARTITION BY n."agenciaId", n."servicioId", n.fecha ORDER BY n.numero, n.id
                   ) AS "numeroFinal"
             FROM nuevos n
             CROSS JOIN LATERAL (
                  SELECT max(t.numero) AS maximo FROM turno t
                   WHERE t.agencia_id = n."agenciaId" AND t.servicio_id = n."servicioId" AND t.fecha = n.fecha
             ) anteriores
      ) INSERT INTO turno (id, agencia_id, servicio_id, asociado_id, fecha, numero, codigo, tipo_atencion, estado,
                            canal, motivo, solicitado_en, proximo_en, confirmado_en, llamado_en, inicio_atencion_en,
                            fin_en, atendido_por, verificado_por)
        SELECT id, "agenciaId", "servicioId", "asociadoId", fecha, "numeroFinal",
               btrim(prefijo_turno) || '-' || lpad("numeroFinal"::text, greatest(3, length("numeroFinal"::text)), '0'),
               "tipoAtencion", estado, canal, motivo, "solicitadoEn", "proximoEn", "confirmadoEn", "llamadoEn",
               "inicioAtencionEn", "finEn", "atendidoPor", "verificadoPor"
        FROM numerados ON CONFLICT (id) DO NOTHING`, [turnos],
    );
    const { rows } = await cliente.query<{ id: string; codigo: string }>(
      `SELECT t.id, t.codigo FROM jsonb_to_recordset($1::jsonb) AS e(
           id uuid, "agenciaId" uuid, "servicioId" uuid, "asociadoId" uuid, fecha date, estado text)
       JOIN turno t ON t.id = e.id AND t.agencia_id = e."agenciaId" AND t.servicio_id = e."servicioId" AND
                       t.asociado_id = e."asociadoId" AND t.fecha = e.fecha AND t.estado = e.estado
       JOIN demo_participante p ON p.usuario_id = t.asociado_id AND p.rol = 'ASOCIADO' AND p.agencia_id = t.agencia_id`, [turnos],
    );
    if (new Set(rows.map(({ id }) => id)).size !== lote.length) {
      throw new Error('Hay turnos repetidos, ajenos a la demostración o con un identificador ya usado para otro registro.');
    }
    return { nuevos: creados.rowCount ?? 0, codigos: new Map(rows.map(({ id, codigo }) => [id, codigo])) };
  });
  const publicadoEn = new Date();
  const eventos = lote.flatMap(({ turno, eventos }) => eventos.map((evento) => ({
    ...evento,
    datos: { ...evento.datos, codigo: codigos.codigos.get(turno.id) },
    ocurridoEn: new Date(evento.ocurridoEn),
    publicadoEn,
  })));
  const resultado = await db.collection(EVENTOS_TURNO_DEMO).bulkWrite(eventos.map((evento) => ({
    updateOne: { filter: { eventoId: evento.eventoId }, update: { $setOnInsert: evento }, upsert: true },
  })), { ordered: false });
  return { turnos: codigos.nuevos, eventos: resultado.upsertedCount };
}

export async function importarHistorial(pool: Pool, db: Db, entrada: Readable) {
  let turnoNuevos = 0;
  let eventosNuevos = 0;
  let procesados = 0;
  const hoy = fechaLocal(new Date());
  let lote: RegistroDemo[] = [];
  const lineas = createInterface({ input: entrada, crlfDelay: Infinity });
  for await (const linea of lineas) {
    if (!linea.trim()) continue;
    lote.push(leerRegistro(linea, hoy));
    procesados++;
    if (lote.length < TAMANO_LOTE) continue;
    const resultado = await guardarLote(pool, db, lote);
    turnoNuevos += resultado.turnos;
    eventosNuevos += resultado.eventos;
    lote = [];
  }
  if (lote.length > 0) {
    const resultado = await guardarLote(pool, db, lote);
    turnoNuevos += resultado.turnos;
    eventosNuevos += resultado.eventos;
  }
  return { turnos: turnoNuevos, eventos: eventosNuevos, procesados };
}

function validarPendientes(entrada: EntradaPendientes, hoy: string): void {
  if (!entrada || entrada.fecha !== hoy || !Array.isArray(entrada.agencias) ||
      entrada.agencias.some((grupo) => !isUUID(grupo.agenciaId) || !isUUID(grupo.servicioId) ||
        !Array.isArray(grupo.asociados) || !grupo.asociados.every((id) => isUUID(id))) ||
      new Set(entrada.agencias.map((grupo) => grupo.agenciaId)).size !== entrada.agencias.length) {
    throw new Error('Indica una lista de agencias elegibles para la fecha actual de Bogotá.');
  }
}

async function reservar(pool: Pool, grupo: GrupoPendientes, fecha: string, lote: string): Promise<ReservaPendiente[]> {
  return enTransaccion(pool, async (cliente) => {
    const { rows: guardados } = await cliente.query<ReservaPendiente>(
      `SELECT ordinal, asociado_id, servicio_id FROM demo_lote_pendiente
       WHERE fecha = $1 AND agencia_id = $2 AND lote = $3 ORDER BY ordinal`, [fecha, grupo.agenciaId, lote],
    );
    if (guardados.length === 3) return guardados;
    const { rows: nuevos } = await cliente.query<ReservaPendiente>(
      `WITH disponibles AS (
         SELECT p.usuario_id, p.ordinal FROM demo_participante p JOIN usuario u ON u.id = p.usuario_id
         WHERE p.rol = 'ASOCIADO' AND p.agencia_id = $2 AND p.usuario_id = ANY($5::uuid[]) AND u.activo
           AND NOT EXISTS (SELECT 1 FROM turno t WHERE t.asociado_id = p.usuario_id AND t.estado = ANY($7::text[]))
           AND NOT EXISTS (SELECT 1 FROM demo_lote_pendiente r WHERE r.fecha = $1 AND r.asociado_id = p.usuario_id)
         ORDER BY p.ordinal LIMIT (3 - $6::integer)
       ) INSERT INTO demo_lote_pendiente (fecha, agencia_id, lote, ordinal, servicio_id, asociado_id)
         SELECT $1, $2, $3, $6::integer + row_number() OVER (ORDER BY ordinal), $4, usuario_id FROM disponibles
         RETURNING ordinal, asociado_id, servicio_id`,
      [fecha, grupo.agenciaId, lote, grupo.servicioId, grupo.asociados, guardados.length, [...ESTADOS_ACTIVOS]],
    );
    return [...guardados, ...nuevos];
  });
}

async function asegurarEventosIniciales(db: Db, turno: DatosTurno): Promise<void> {
  const coleccion = db.collection(EVENTOS_TURNO_DEMO);
  if (await coleccion.findOne({ turnoId: turno.id, estadoNuevo: EstadoTurno.SOLICITADO })) return;
  // El flujo normal pudo guardar la solicitud en PostgreSQL justo antes de perder la conexión con MongoDB.
  const inicial = {
    turnoId: turno.id, agenciaId: turno.agenciaId, servicioId: turno.servicioId, asociadoId: turno.asociadoId,
    tipoAtencion: turno.tipoAtencion, canal: turno.canal, datos: turno.codigo ? { codigo: turno.codigo } : {},
    publicadoEn: new Date(),
  };
  const reparacion = [{ estado: EstadoTurno.SOLICITADO, ocurridoEn: turno.solicitadoEn, actorId: turno.asociadoId }];
  if (turno.numero !== null) reparacion.push({ estado: EstadoTurno.EN_ESPERA, ocurridoEn: turno.solicitadoEn, actorId: '' });
  if (turno.proximoEn) reparacion.push({ estado: EstadoTurno.PROXIMO, ocurridoEn: turno.proximoEn, actorId: '' });
  if (turno.estado === EstadoTurno.CANCELADO && turno.finEn) {
    reparacion.push({ estado: EstadoTurno.CANCELADO, ocurridoEn: turno.finEn, actorId: '' });
  }
  for (const [indice, { estado, ocurridoEn, actorId }] of reparacion.entries()) {
    const eventoId = `${turno.id}:demo-reparado:${estado}`;
    await coleccion.updateOne({ eventoId }, { $setOnInsert: {
      ...inicial, eventoId, tipo: nombreEvento(estado), estadoNuevo: estado,
      estadoAnterior: reparacion[indice - 1]?.estado ?? null, ocurridoEn, actorId: actorId || null,
    } }, { upsert: true });
  }
}

export async function dejarPendientes(
  pool: Pool, db: Db, catalogo: CatalogoPort, jornadas: JornadasPort, turnosRepo: TurnoRepository,
  solicitar: SolicitarTurnoUseCase, entrada: EntradaPendientes, lote: string,
  reloj: RelojPort = { ahora: () => new Date() },
) {
  validarPendientes(entrada, fechaLocal(reloj.ahora()));
  const { fecha, agencias } = entrada;
  const dia = new Date(`${fecha}T12:00:00Z`).getUTCDay();
  const turnos: ResumenTurno[] = [];
  const omitidas: { agenciaId: string; motivo: string }[] = [];
  if (dia === 0 || dia === 6) return { fecha, lote, pendientes: 0, turnos, omitidas, fueraDeJornada: true };

  for (const grupo of agencias) {
    const fila = await catalogo.obtenerFila(grupo.agenciaId, grupo.servicioId);
    const ahora = reloj.ahora();
    if (fechaLocal(ahora) !== fecha || !fila?.estaAbierta(ahora) || await jornadas.estaCerrada(grupo.agenciaId, fecha)) {
      omitidas.push({ agenciaId: grupo.agenciaId, motivo: 'Fuera del horario de atención o jornada cerrada.' });
      continue;
    }
    const reservados = await reservar(pool, grupo, fecha, lote);
    if (reservados.length < 3) omitidas.push({ agenciaId: grupo.agenciaId, motivo: 'Hay menos de tres asociados de prueba disponibles.' });
    for (const reserva of reservados) {
      const idempotencyKey = claveDemo('pendientes', fecha, grupo.agenciaId, lote, reserva.ordinal);
      try {
        const turno = await solicitar.ejecutar({
          asociadoId: reserva.asociado_id, agenciaId: grupo.agenciaId, servicioId: reserva.servicio_id,
          solicitaPreferencial: false, canal: 'WEB', idempotencyKey,
        });
        const persistido = await turnosRepo.obtener(turno.id);
        if (!persistido) throw new Error('No se encontró la solicitud reservada en PostgreSQL.');
        await asegurarEventosIniciales(db, persistido.instantanea());
        if (turno.estado === EstadoTurno.SOLICITADO) {
          throw new Error('Una solicitud anterior quedó sin activar. Revisa esa fila antes de continuar.');
        }
        turnos.push(turno);
      } catch (error) {
        if (!(error instanceof ErrorDeDominio) || !['AGENCIA_CERRADA', 'JORNADA_CERRADA', 'TURNO_ACTIVO', 'FILA_NO_EXISTE'].includes(error.codigo)) {
          throw error;
        }
        omitidas.push({ agenciaId: grupo.agenciaId, motivo: error.message });
      }
    }
  }
  return {
    fecha, lote, pendientes: turnos.filter((turno) => ESTADOS_ACTIVOS.has(turno.estado)).length,
    turnos, omitidas, fueraDeJornada: turnos.length === 0,
  };
}
