import { Inject, Injectable } from '@nestjs/common';
import { Db, MongoBulkWriteError } from 'mongodb';
import { EVENTOS_TURNO_DEMO, PARTICIPANTES_DEMO, type ParticipanteDemoMongo } from '../../../../compartido/infrastructure/demo-mongo';
import { MONGO_DB } from '../../../../compartido/infrastructure/recursos';
import type { EventStorePort } from '../../../application/ports/out/otros.ports';
import type { EventoTurnoPublicable } from '../../../domain/evento-turno';

/** Adaptador de salida: historial de eventos en MongoDB (colección eventos_turno). */
@Injectable()
export class EventosMongoAdapter implements EventStorePort {
  constructor(@Inject(MONGO_DB) private readonly db: Db) {}

  async publicar(eventos: EventoTurnoPublicable[]): Promise<void> {
    if (eventos.length === 0) return;
    const asociados = [...new Set(eventos.map((evento) => evento.asociadoId))];
    const participantes = await this.db.collection<ParticipanteDemoMongo>(PARTICIPANTES_DEMO)
      .find({ _id: { $in: asociados } }, { projection: { _id: 1 } }).toArray();
    const asociadosDemo = new Set(participantes.map(({ _id }) => _id));
    const ordinarios = eventos.filter((evento) => !asociadosDemo.has(evento.asociadoId));
    const publicadosEn = new Date();
    const simulados = eventos.filter((evento) => asociadosDemo.has(evento.asociadoId))
      .map((evento) => ({ ...evento, publicadoEn: publicadosEn }));
    await this.insertar('eventos_turno', ordinarios);
    await this.insertar(EVENTOS_TURNO_DEMO, simulados);
  }

  private async insertar(coleccion: string, eventos: EventoTurnoPublicable[]): Promise<void> {
    if (eventos.length === 0) return;
    try {
      await this.db.collection(coleccion).insertMany(
        eventos.map((evento) => ({ ...evento })),
        { ordered: false },
      );
    } catch (error) {
      // Reintento de un evento ya guardado: el índice único ux_evento lo rechaza y se ignora.
      if (!soloDuplicados(error)) throw error;
    }
  }
}

function soloDuplicados(error: unknown): boolean {
  if (!(error instanceof MongoBulkWriteError)) return false;
  const errores = Array.isArray(error.writeErrors) ? error.writeErrors : [error.writeErrors];
  return errores.length > 0 && errores.every((e) => e.code === 11000);
}
