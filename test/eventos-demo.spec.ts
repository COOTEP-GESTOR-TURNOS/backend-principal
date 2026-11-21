import type { Db } from 'mongodb';
import { EVENTOS_TURNO_DEMO, PARTICIPANTES_DEMO } from '../src/compartido/infrastructure/demo-mongo';
import { EstadoTurno } from '../src/turnos/domain/estado-turno';
import type { EventoTurnoPublicable } from '../src/turnos/domain/evento-turno';
import { EventosMongoAdapter } from '../src/turnos/infrastructure/out/mongo/eventos-mongo.adapter';

it('separa los eventos demo según el participante asociado, incluso si la atención la hace otro usuario', async () => {
  const insertados: Record<string, EventoTurnoPublicable[]> = {};
  const db = { collection: (nombre: string) => ({
    find: (filtro: { _id: { $in: string[] } }) => ({
      toArray: async () => {
        expect(nombre).toBe(PARTICIPANTES_DEMO);
        expect(filtro._id.$in).toEqual(['ficticio', 'habitual']);
        return [{ _id: 'ficticio' }];
      },
    }),
    insertMany: async (eventos: EventoTurnoPublicable[]) => { insertados[nombre] = eventos; },
  }) } as unknown as Db;
  const base: EventoTurnoPublicable = {
    eventoId: 'demo', tipo: 'TurnoAtendido', turnoId: 'demo', agenciaId: 'agencia', servicioId: 'servicio',
    asociadoId: 'ficticio', estadoAnterior: EstadoTurno.EN_ATENCION, estadoNuevo: EstadoTurno.ATENDIDO,
    tipoAtencion: 'GENERAL', canal: 'WEB', actorId: 'funcionario', ocurridoEn: new Date('2026-11-20T14:00:00Z'), datos: {},
  };
  await new EventosMongoAdapter(db).publicar([base, { ...base, eventoId: 'real', turnoId: 'real', asociadoId: 'habitual' }]);
  expect(insertados[EVENTOS_TURNO_DEMO]).toEqual([{ ...base, publicadoEn: expect.any(Date) }]);
  expect(insertados.eventos_turno).toEqual([{ ...base, eventoId: 'real', turnoId: 'real', asociadoId: 'habitual' }]);
});
