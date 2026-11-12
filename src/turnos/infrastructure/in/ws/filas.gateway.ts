import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { VerificadorTokens } from '../../../../compartido/infrastructure/auth/verificador-tokens';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Adaptador de entrada de tiempo real. Al conectar, el cliente entra a la sala usuario:{id};
 * con fila:suscribir entra a fila:{agencia}:{servicio}. Las salas de fila no llevan datos personales.
 */
@WebSocketGateway({ cors: { origin: true, credentials: true } })
export class FilasGateway implements OnGatewayConnection {
  private readonly logger = new Logger(FilasGateway.name);

  @WebSocketServer()
  servidor?: Server;

  constructor(private readonly tokens: VerificadorTokens) {}

  async handleConnection(cliente: Socket): Promise<void> {
    try {
      const token = String(cliente.handshake.auth?.token ?? '');
      const principal = await this.tokens.verificar(token);
      cliente.data.principal = principal;
      await cliente.join(`usuario:${principal.id}`);
    } catch {
      this.logger.debug('Conexión de socket rechazada: token inválido');
      cliente.disconnect(true);
    }
  }

  @SubscribeMessage('fila:suscribir')
  async suscribir(
    @ConnectedSocket() cliente: Socket,
    @MessageBody() cuerpo: { agenciaId?: string; servicioId?: string },
  ): Promise<{ ok: boolean }> {
    if (!UUID.test(cuerpo?.agenciaId ?? '') || !UUID.test(cuerpo?.servicioId ?? '')) {
      return { ok: false };
    }
    await cliente.join(`fila:${cuerpo.agenciaId}:${cuerpo.servicioId}`);
    return { ok: true };
  }
}
