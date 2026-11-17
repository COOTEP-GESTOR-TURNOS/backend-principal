import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { leerConfig } from './compartido/infrastructure/config';
import { middlewareRequestId } from './compartido/infrastructure/contexto-solicitud';
import { ProblemDetailsFilter } from './compartido/infrastructure/http/problem-details.filter';

/**
 * Tubería HTTP común: la usan main.ts y las pruebas de integración, así las pruebas pasan por el
 * mismo prefijo, validación y formato de errores (Problem Details) que el servicio desplegado.
 */
export function configurarApp(app: NestExpressApplication): NestExpressApplication {
  // nginx (web) está en la red interna: se confía en su X-Forwarded-For para obtener la IP real,
  // que usa el límite de intentos de inicio de sesión.
  app.set('trust proxy', 'loopback, uniquelocal');
  app.use(middlewareRequestId);
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new ProblemDetailsFilter());
  app.enableCors({ origin: leerConfig().corsOrigenes, credentials: true });
  return app;
}
