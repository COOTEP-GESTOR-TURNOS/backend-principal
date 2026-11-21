import type { Db } from 'mongodb';

export const EVENTOS_TURNO_DEMO = 'eventos_turno_demo';
export const PARTICIPANTES_DEMO = 'participantes_demo';

export interface ParticipanteDemoMongo {
  _id: string;
  agenciaId: string;
}

/** También ejecutable en las bases locales que ya habían sido inicializadas. */
export async function prepararEventosDemo(db: Db): Promise<void> {
  await db.collection(EVENTOS_TURNO_DEMO).createIndexes([
    { key: { eventoId: 1 }, name: 'ux_evento_demo', unique: true },
    { key: { publicadoEn: 1, turnoId: 1 }, name: 'ix_publicacion_demo' },
    { key: { turnoId: 1, ocurridoEn: 1 }, name: 'ix_turno_tiempo_demo' },
  ]);
}
