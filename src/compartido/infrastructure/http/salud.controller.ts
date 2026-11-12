import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles, RolesGuard } from '../auth/roles';
import { CacheRedisAdapter } from '../cache/cache-redis.adapter';

@ApiTags('operación')
@Controller()
export class SaludController {
  constructor(private readonly cache: CacheRedisAdapter) {}

  /** Healthcheck de Docker. No consulta los motores para no reiniciar el contenedor si uno falla. */
  @Get('salud')
  salud() {
    return { estado: 'ok', servicio: 'backend-principal', hora: new Date().toISOString() };
  }

  /** Aciertos, fallos y latencia de la caché por prefijo (sección 10 del informe). */
  @Get('metricas')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN', 'ADMIN_AGENCIA')
  metricas() {
    return { cache: this.cache.resumen() };
  }
}
