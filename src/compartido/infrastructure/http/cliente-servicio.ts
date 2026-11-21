import { randomUUID } from 'node:crypto';
import { ServicioNoDisponibleError } from '../../application/errores-aplicacion';
import { TIEMPO_LIMITE_SERVICIOS_MS } from '../config';
import { requestIdActual } from '../contexto-solicitud';

export interface Respuesta<T> {
  status: number;
  datos: T | null;
}

interface Opciones {
  cuerpo?: unknown;
  /** Solo las operaciones idempotentes se reintentan (encolar, retirar, consultas). */
  reintentable: boolean;
  tiempoLimiteMs?: number;
  estadosSinDatos?: readonly number[];
}

/**
 * Llamada HTTP entre servicios: token de servicio, X-Request-Id propagado y tiempo límite de 2 s
 * con AbortSignal (la petición se cancela de verdad). 404 y 204 devuelven datos null.
 */
export async function llamarServicio<T>(
  baseUrl: string,
  token: string,
  metodo: string,
  ruta: string,
  { cuerpo, reintentable, tiempoLimiteMs = TIEMPO_LIMITE_SERVICIOS_MS, estadosSinDatos = [] }: Opciones,
): Promise<Respuesta<T>> {
  const intentos = reintentable ? 3 : 1;
  let ultimoError: unknown;
  for (let intento = 1; intento <= intentos; intento++) {
    let respuesta: Response;
    try {
      respuesta = await fetch(`${baseUrl}${ruta}`, {
        method: metodo,
        headers: {
          'Content-Type': 'application/json',
          'X-Service-Token': token,
          'X-Request-Id': requestIdActual() ?? randomUUID(),
        },
        body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
        signal: AbortSignal.timeout(tiempoLimiteMs),
      });
    } catch (error) {
      ultimoError = error; // red caída o tiempo límite: se puede reintentar
      continue;
    }
    if (respuesta.status >= 500) {
      ultimoError = new Error(`respondió ${respuesta.status}`);
      continue;
    }
    if (respuesta.status === 204 || respuesta.status === 404 || estadosSinDatos.includes(respuesta.status)) {
      return { status: respuesta.status, datos: null };
    }
    if (respuesta.status >= 400) {
      // Error de contrato: reintentar no sirve.
      throw new Error(`${metodo} ${ruta} rechazado con ${respuesta.status}: ${await respuesta.text()}`);
    }
    return { status: respuesta.status, datos: (await respuesta.json()) as T };
  }
  throw new ServicioNoDisponibleError(`${baseUrl} no disponible (${String(ultimoError)})`);
}
