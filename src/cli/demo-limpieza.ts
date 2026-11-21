import type { Db } from 'mongodb';
import type { Pool } from 'pg';
import type { MotorFilasPort } from '../turnos/application/ports/out/motor-filas.port';
import { ESTADOS_ACTIVOS } from '../turnos/domain/estado-turno';
import { enTransaccion, EVENTOS_TURNO } from './demo-cuentas';

export interface ResultadoLimpieza {
  cuentas: number;
  turnos: number;
  retiradosDeFilas: number;
  eventos: number;
}

/**
 * Borra lo que dejó la demostración en PostgreSQL y en las filas del motor, y los eventos de los
 * turnos de sus participantes. La analítica (`generar_demo limpiar`) borra después los eventos
 * marcados como simulados y los de las agencias, y reconstruye ClickHouse.
 */
export async function limpiarDemo(pool: Pool, db: Db, motor: MotorFilasPort): Promise<ResultadoLimpieza> {
  const { rows } = await pool.query<{ usuario_id: string }>('SELECT usuario_id FROM demo_participante');
  const ids = rows.map(({ usuario_id }) => usuario_id);

  // Primero fuera de las filas: un turno borrado no puede quedar esperando a que lo llamen.
  const { rows: activos } = await pool.query<{ id: string; agencia_id: string; servicio_id: string }>(
    'SELECT id, agencia_id, servicio_id FROM turno WHERE asociado_id = ANY($1::uuid[]) AND estado = ANY($2::text[])',
    [ids, [...ESTADOS_ACTIVOS]],
  );
  for (const turno of activos) await motor.retirar(`${turno.agencia_id}:${turno.servicio_id}`, turno.id);

  // Los pendientes entraron por el flujo normal (sin marca): se reconocen por su asociado.
  const eventos = ids.length ? (await db.collection(EVENTOS_TURNO).deleteMany({ asociadoId: { $in: ids } })).deletedCount : 0;

  const borrado = await enTransaccion(pool, async (cliente) => {
    await cliente.query('DELETE FROM demo_lote_pendiente');
    const turnos = await cliente.query('DELETE FROM turno WHERE asociado_id = ANY($1::uuid[])', [ids]);
    // Referencias de los participantes en registros que no son de la demostración.
    for (const [tabla, columna] of [
      ['turno', 'atendido_por'], ['turno', 'verificado_por'], ['asignacion_rol', 'asignado_por'],
      ['agencia_servicio', 'actualizado_por'], ['parametro', 'actualizado_por'],
    ]) {
      await cliente.query(`UPDATE ${tabla} SET ${columna} = NULL WHERE ${columna} = ANY($1::uuid[])`, [ids]);
    }
    await cliente.query('DELETE FROM asignacion_rol WHERE usuario_id = ANY($1::uuid[])', [ids]);
    await cliente.query('DELETE FROM identidad_federada WHERE usuario_id = ANY($1::uuid[])', [ids]);
    await cliente.query('DELETE FROM demo_participante');
    const cuentas = await cliente.query('DELETE FROM usuario WHERE id = ANY($1::uuid[])', [ids]);
    await cliente.query('DELETE FROM demo_escenario');
    return { cuentas: cuentas.rowCount ?? 0, turnos: turnos.rowCount ?? 0 };
  });
  return { ...borrado, retiradosDeFilas: activos.length, eventos };
}
