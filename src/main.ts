import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { leerConfig } from './compartido/infrastructure/config';
import { middlewareRequestId } from './compartido/infrastructure/contexto-solicitud';
import { ProblemDetailsFilter } from './compartido/infrastructure/http/problem-details.filter';
import { AesGcmAdapter } from './identidad/infrastructure/out/seguridad/aes-gcm.adapter';

async function arrancar(): Promise<void> {
  // En desarrollo carga .env; en Docker las variables vienen del compose y no hay archivo.
  try {
    process.loadEnvFile();
  } catch {
    /* sin archivo .env */
  }
  const config = leerConfig();
  if (config.jwtSecreto.length < 32) {
    throw new Error('JWT_SECRETO debe tener al menos 32 caracteres');
  }
  AesGcmAdapter.leerClave(config.claveCifradoMfa); // falla al arrancar si CLAVE_CIFRADO_MFA no sirve

  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // nginx (web) está en la red interna: se confía en su X-Forwarded-For para obtener la IP real,
  // que usa el límite de intentos de inicio de sesión.
  app.set('trust proxy', 'loopback, uniquelocal');
  app.use(middlewareRequestId);
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new ProblemDetailsFilter());
  app.enableCors({ origin: config.corsOrigenes, credentials: true });
  app.enableShutdownHooks();

  const documento = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('COOTEP Turno · backend principal')
      .setDescription('API pública de la web y la app móvil. Errores en formato Problem Details (RFC 9457).')
      .setVersion('1.0.0')
      .addBearerAuth()
      .build(),
  );
  SwaggerModule.setup('api/docs', app, documento);

  await app.listen(config.puerto, '0.0.0.0');
  Logger.log(`Escuchando en el puerto ${config.puerto} · OpenAPI en /api/docs`, 'Arranque');
}

void arrancar();
