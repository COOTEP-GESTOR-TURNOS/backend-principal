import { Injectable } from '@nestjs/common';
import type { NotificadorPort } from '../../../application/ports/out/otros.ports';
import type { ResumenTurno } from '../../../application/resumen-turno';
import { EstadoTurno } from '../../../domain/estado-turno';
import { FilasGateway } from '../../in/ws/filas.gateway';

/** Adaptador de salida: avisos en tiempo real por las salas de Socket.IO. */
@Injectable()
export class NotificadorSocketAdapter implements NotificadorPort {
  constructor(private readonly gateway: FilasGateway) {}

  async filaActualizada(filaId: string): Promise<void> {
    this.gateway.servidor?.to(`fila:${filaId}`).emit('fila:actualizada', { filaId, en: new Date().toISOString() });
  }

  async turnoActualizado(asociadoId: string, resumen: ResumenTurno): Promise<void> {
    const sala = this.gateway.servidor?.to(`usuario:${asociadoId}`);
    if (!sala) return;
    sala.emit('turno:estado', resumen);
    if (resumen.estado === EstadoTurno.PROXIMO) sala.emit('turno:proximo', resumen);
    if (resumen.estado === EstadoTurno.LLAMADO) sala.emit('turno:llamado', resumen);
  }
}
