import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { ServicioNoDisponibleError } from '../../../../compartido/application/errores-aplicacion';
import { leerConfig } from '../../../../compartido/infrastructure/config';
import type { CorreoPort, MensajeCorreo } from '../../../application/ports/out/seguridad.ports';

/**
 * Envía los correos por SMTP. En desarrollo apunta a Mailpit (bandeja en http://localhost:8025);
 * con SMTP_* en infra/.env se cambia a un servidor real, por ejemplo Gmail con contraseña de aplicación.
 */
@Injectable()
export class SmtpCorreoAdapter implements CorreoPort, OnModuleDestroy {
  private readonly logger = new Logger(SmtpCorreoAdapter.name);
  private readonly transporte: Transporter;
  private readonly remitente: string;

  constructor() {
    const { smtp } = leerConfig();
    this.remitente = smtp.remitente;
    this.transporte = createTransport({
      host: smtp.host,
      port: smtp.puerto,
      secure: smtp.seguro,
      auth: smtp.usuario ? { user: smtp.usuario, pass: smtp.clave } : undefined,
      connectionTimeout: 5000,
      greetingTimeout: 5000,
      socketTimeout: 10000,
    });
  }

  async enviar(m: MensajeCorreo): Promise<void> {
    try {
      await this.transporte.sendMail({ from: this.remitente, to: m.para, subject: m.asunto, text: m.texto, html: m.html });
    } catch (error) {
      // No se registra el destinatario ni el contenido: llevan enlaces de un solo uso.
      this.logger.warn(`No se pudo enviar el correo "${m.asunto}": ${String(error)}`);
      throw new ServicioNoDisponibleError('No se pudo enviar el correo. Intenta más tarde');
    }
  }

  onModuleDestroy(): void {
    this.transporte.close();
  }
}
