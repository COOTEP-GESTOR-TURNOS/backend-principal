import { Controller, Get, Inject, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, Matches, Max, MaxLength, Min } from 'class-validator';
import type { Principal } from '../../../../compartido/domain/principal';
import { JwtAuthGuard } from '../../../../compartido/infrastructure/auth/jwt-auth.guard';
import { PrincipalActual, Roles, RolesGuard } from '../../../../compartido/infrastructure/auth/roles';
import { CONSULTAR_AUDITORIA, type ConsultarAuditoriaUseCase } from '../../../application/ports/in/consultar-auditoria.use-case';

class PaginaQuery {
  @ApiPropertyOptional({ default: 50, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limite?: number;

  @ApiPropertyOptional({ description: 'Valor "siguiente" de la página anterior' })
  @IsOptional()
  @Matches(/^[0-9a-f]+$/i, { message: 'El valor de siguiente no es válido' })
  @MaxLength(2000)
  siguiente?: string;
}

export class AuditoriaAmbitoQuery extends PaginaQuery {
  @ApiProperty({ example: 'GLOBAL', description: 'GLOBAL o el id de una agencia' })
  @Matches(/^(GLOBAL|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i, { message: 'El ámbito es GLOBAL o el id de una agencia' })
  ambito!: string;

  @ApiPropertyOptional({ example: '2026-11-16', description: 'Por defecto, hoy en la hora de Colombia' })
  @IsOptional()
  @IsDateString({ strict: true })
  dia?: string;

  @ApiPropertyOptional({ example: 'INTENTO_FUERA_DE_AMBITO' })
  @IsOptional()
  @Matches(/^[A-Z_]{3,40}$/)
  accion?: string;
}

export class AuditoriaActorQuery extends PaginaQuery {
  @ApiPropertyOptional({ example: '2026-11', description: 'Por defecto, el mes actual' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}$/)
  mes?: string;
}

/**
 * Adaptador de entrada REST de la auditoría (RF-20). Solo lectura: la API no tiene ninguna
 * operación para editar o borrar registros.
 */
@ApiTags('auditoría')
@ApiBearerAuth()
@Controller('admin/auditoria')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPERADMIN')
export class AuditoriaController {
  constructor(@Inject(CONSULTAR_AUDITORIA) private readonly consultar: ConsultarAuditoriaUseCase) {}

  @Get()
  @ApiOperation({ summary: 'CU-06: registros de un ámbito (GLOBAL o agencia) en un día, del más reciente al más antiguo' })
  porAmbitoDia(@PrincipalActual() actor: Principal, @Query() q: AuditoriaAmbitoQuery) {
    return this.consultar.porAmbitoDia(actor, { ...q, dia: q.dia?.slice(0, 10) });
  }

  @Get('actores/:actorId')
  @ApiOperation({ summary: 'Qué hizo una persona en un mes (segunda tabla de consulta de Cassandra)' })
  porActorMes(@PrincipalActual() actor: Principal, @Param('actorId', new ParseUUIDPipe()) actorId: string, @Query() q: AuditoriaActorQuery) {
    return this.consultar.porActorMes(actor, { actorId, ...q });
  }
}
