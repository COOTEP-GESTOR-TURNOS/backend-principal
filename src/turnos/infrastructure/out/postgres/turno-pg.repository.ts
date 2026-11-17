import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { ConflictoError } from '../../../../compartido/domain/errores';
import { PG_POOL } from '../../../../compartido/infrastructure/recursos';
import type { TurnoRepository } from '../../../application/ports/out/turno.repository';
import { EstadoTurno, ESTADOS_ACTIVOS } from '../../../domain/estado-turno';
import type { Canal, TipoAtencion } from '../../../domain/tipos';
import { DatosTurno, Turno } from '../../../domain/turno';

interface FilaTurno {
  id: string;
  agencia_id: string;
  servicio_id: string;
  asociado_id: string;
  fecha: string;
  numero: number | null;
  codigo: string | null;
  tipo_atencion: TipoAtencion;
  estado: EstadoTurno;
  canal: Canal;
  motivo: string | null;
  solicitado_en: Date;
  proximo_en: Date | null;
  confirmado_en: Date | null;
  llamado_en: Date | null;
  inicio_atencion_en: Date | null;
  fin_en: Date | null;
  atendido_por: string | null;
  verificado_por: string | null;
  idempotency_key: string | null;
  version: number;
}

const ACTIVOS = [...ESTADOS_ACTIVOS];

/** Adaptador de salida: PostgreSQL es la fuente de verdad del turno. */
@Injectable()
export class TurnoPgRepository implements TurnoRepository {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async guardarNuevo(turno: Turno): Promise<void> {
    const t = turno.instantanea();
    try {
      await this.pool.query(
        `INSERT INTO turno (id, agencia_id, servicio_id, asociado_id, fecha, numero, codigo, tipo_atencion,
                            estado, canal, motivo, solicitado_en, idempotency_key, version)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 0)`,
        [t.id, t.agenciaId, t.servicioId, t.asociadoId, t.fecha, t.numero, t.codigo, t.tipoAtencion,
         t.estado, t.canal, t.motivo, t.solicitadoEn, t.idempotencyKey],
      );
    } catch (error) {
      throw traducirError(error);
    }
  }

  async actualizar(turno: Turno): Promise<void> {
    const t = turno.instantanea();
    let filasAfectadas: number | null;
    try {
      const resultado = await this.pool.query(
        `UPDATE turno
            SET numero = $2, codigo = $3, tipo_atencion = $4, estado = $5, motivo = $6,
                proximo_en = $7, confirmado_en = $8, llamado_en = $9, inicio_atencion_en = $10,
                fin_en = $11, atendido_por = $12, verificado_por = $13, version = version + 1
          WHERE id = $1 AND version = $14`,
        [t.id, t.numero, t.codigo, t.tipoAtencion, t.estado, t.motivo, t.proximoEn, t.confirmadoEn,
         t.llamadoEn, t.inicioAtencionEn, t.finEn, t.atendidoPor, t.verificadoPor, t.version],
      );
      filasAfectadas = resultado.rowCount;
    } catch (error) {
      throw traducirError(error);
    }
    if (!filasAfectadas) {
      throw new ConflictoError('TURNO_MODIFICADO', 'El turno cambió mientras se procesaba; intente de nuevo');
    }
    turno.alGuardar(t.version + 1);
  }

  async obtener(id: string): Promise<Turno | null> {
    const { rows } = await this.pool.query<FilaTurno>('SELECT * FROM turno WHERE id = $1', [id]);
    return rows[0] ? aDominio(rows[0]) : null;
  }

  async buscarPorIdempotencia(asociadoId: string, clave: string): Promise<Turno | null> {
    const { rows } = await this.pool.query<FilaTurno>(
      'SELECT * FROM turno WHERE asociado_id = $1 AND idempotency_key = $2',
      [asociadoId, clave],
    );
    return rows[0] ? aDominio(rows[0]) : null;
  }

  async buscarActivoDeAsociado(asociadoId: string): Promise<Turno | null> {
    const { rows } = await this.pool.query<FilaTurno>(
      'SELECT * FROM turno WHERE asociado_id = $1 AND estado = ANY($2::text[])',
      [asociadoId, ACTIVOS],
    );
    return rows[0] ? aDominio(rows[0]) : null;
  }

  async buscarDelDiaPorEstado(fecha: string, estados: EstadoTurno[], agenciaId?: string): Promise<Turno[]> {
    // ix_turno_fila_estado cubre (agencia, servicio, fecha, estado): con agencia, la consulta lo usa.
    const { rows } = await this.pool.query<FilaTurno>(
      `SELECT * FROM turno
        WHERE fecha = $1 AND estado = ANY($2::text[]) AND ($3::uuid IS NULL OR agencia_id = $3)
        ORDER BY agencia_id, servicio_id, numero`,
      [fecha, estados, agenciaId ?? null],
    );
    return rows.map(aDominio);
  }
}

function aDominio(f: FilaTurno): Turno {
  const datos: DatosTurno = {
    id: f.id,
    agenciaId: f.agencia_id,
    servicioId: f.servicio_id,
    asociadoId: f.asociado_id,
    fecha: f.fecha,
    numero: f.numero,
    codigo: f.codigo,
    tipoAtencion: f.tipo_atencion,
    estado: f.estado,
    canal: f.canal,
    motivo: f.motivo,
    solicitadoEn: f.solicitado_en,
    proximoEn: f.proximo_en,
    confirmadoEn: f.confirmado_en,
    llamadoEn: f.llamado_en,
    inicioAtencionEn: f.inicio_atencion_en,
    finEn: f.fin_en,
    atendidoPor: f.atendido_por,
    verificadoPor: f.verificado_por,
    idempotencyKey: f.idempotency_key,
    version: f.version,
  };
  return Turno.reconstruir(datos);
}

/** Traduce las violaciones de índices únicos (código 23505) a conflictos del dominio. */
function traducirError(error: unknown): Error {
  const pg = error as { code?: string; constraint?: string };
  if (pg.code === '23505') {
    switch (pg.constraint) {
      case 'ux_turno_activo_asociado':
        return new ConflictoError('TURNO_ACTIVO', 'Ya tienes un turno activo');
      case 'ux_turno_idempotencia':
        return new ConflictoError('SOLICITUD_DUPLICADA', 'Esta solicitud ya fue registrada');
      case 'ux_turno_numero':
        return new ConflictoError('NUMERO_DUPLICADO', 'El número de turno ya existe en esta fila');
    }
  }
  return error instanceof Error ? error : new Error(String(error));
}
