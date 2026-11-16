import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  DemasiadosIntentosError,
  NoAutenticadoError,
  ServicioNoDisponibleError,
} from '../../application/errores-aplicacion';
import {
  ConflictoError,
  NoEncontradoError,
  PermisoDenegadoError,
  ReglaNegocioError,
} from '../../domain/errores';
import { requestIdActual } from '../contexto-solicitud';

const TITULOS: Record<number, string> = {
  400: 'Datos inválidos',
  401: 'Sesión requerida',
  403: 'Sin permiso',
  404: 'No encontrado',
  409: 'Conflicto',
  422: 'Regla de negocio incumplida',
  429: 'Demasiados intentos',
  501: 'Pendiente de implementar',
  503: 'Servicio no disponible',
  500: 'Error interno',
};

interface Traduccion {
  status: number;
  codigo: string;
  detalle: string;
}

/** Traduce cualquier error a Problem Details (RFC 9457) con un código estable. */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(error: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') {
      throw error;
    }
    const http = host.switchToHttp();
    const respuesta = http.getResponse<Response>();
    const peticion = http.getRequest<Request>();
    const { status, codigo, detalle } = this.traducir(error);
    if (error instanceof DemasiadosIntentosError && error.reintentarEnSegundos) {
      respuesta.setHeader('Retry-After', String(error.reintentarEnSegundos));
    }

    respuesta
      .status(status)
      .type('application/problem+json')
      .json({
        type: `https://cootep-turno.local/errores/${codigo.toLowerCase().replace(/_/g, '-')}`,
        title: TITULOS[status] ?? 'Error',
        status,
        detail: detalle,
        instance: peticion.originalUrl,
        codigo,
        requestId: requestIdActual(),
      });
  }

  private traducir(error: unknown): Traduccion {
    if (error instanceof HttpException) {
      const status = error.getStatus();
      const cuerpo = error.getResponse();
      const mensaje =
        typeof cuerpo === 'string' ? cuerpo : (cuerpo as { message?: string | string[] }).message ?? error.message;
      return {
        status,
        codigo: status === 400 ? 'DATOS_INVALIDOS' : `HTTP_${status}`,
        detalle: Array.isArray(mensaje) ? mensaje.join('; ') : mensaje,
      };
    }
    if (error instanceof ConflictoError) return { status: 409, codigo: error.codigo, detalle: error.message };
    if (error instanceof ReglaNegocioError) return { status: 422, codigo: error.codigo, detalle: error.message };
    if (error instanceof NoEncontradoError) return { status: 404, codigo: error.codigo, detalle: error.message };
    if (error instanceof PermisoDenegadoError) return { status: 403, codigo: error.codigo, detalle: error.message };
    if (error instanceof NoAutenticadoError) return { status: 401, codigo: error.codigo, detalle: error.message };
    if (error instanceof DemasiadosIntentosError) return { status: 429, codigo: error.codigo, detalle: error.message };
    if (error instanceof ServicioNoDisponibleError) {
      this.logger.warn(error.message);
      return { status: 503, codigo: error.codigo, detalle: error.message };
    }
    this.logger.error(error instanceof Error ? error.stack ?? error.message : String(error));
    return { status: 500, codigo: 'ERROR_INTERNO', detalle: 'Ocurrió un error inesperado' };
  }
}
