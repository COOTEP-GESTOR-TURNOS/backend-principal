import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

interface ContextoSolicitud {
  requestId: string;
}

const contexto = new AsyncLocalStorage<ContextoSolicitud>();

/** Identificador de la petición en curso; los adaptadores lo propagan como X-Request-Id. */
export function requestIdActual(): string | undefined {
  return contexto.getStore()?.requestId;
}

/** Middleware: toma el X-Request-Id entrante (o crea uno) y lo deja disponible en toda la petición. */
export function middlewareRequestId(req: Request, res: Response, next: NextFunction): void {
  const entrante = req.header('x-request-id');
  const requestId = entrante && /^[\w-]{8,64}$/.test(entrante) ? entrante : randomUUID();
  res.setHeader('X-Request-Id', requestId);
  contexto.run({ requestId }, () => next());
}
