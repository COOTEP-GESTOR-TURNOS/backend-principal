import { Controller, Get, Inject, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsUUID } from 'class-validator';
import type { Request } from 'express';
import type { Principal } from '../../../../compartido/domain/principal';
import { JwtAuthGuard } from '../../../../compartido/infrastructure/auth/jwt-auth.guard';
import { PrincipalActual, Roles, RolesGuard } from '../../../../compartido/infrastructure/auth/roles';
import { CONSULTAR_INDICADORES, type ConsultarIndicadoresUseCase } from '../../../application/ports/in/consultar-indicadores.use-case';

export class IndicadoresQuery {
  @ApiPropertyOptional({ description: 'Sin agencia: todas las de su ámbito' })
  @IsOptional()
  @IsUUID()
  agenciaId?: string;

  @ApiPropertyOptional({ example: '2026-10-18', description: 'Por defecto, 30 días antes de hasta' })
  @IsOptional()
  @IsDateString({ strict: true })
  desde?: string;

  @ApiPropertyOptional({ example: '2026-11-16', description: 'Por defecto, hoy en la hora de Colombia' })
  @IsOptional()
  @IsDateString({ strict: true })
  hasta?: string;
}

/** Adaptador de entrada REST del tablero (sección 6 del informe: "Administradores de su ámbito"). */
@ApiTags('analítica')
@ApiBearerAuth()
@Controller('indicadores')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPERADMIN', 'ADMIN_AGENCIA')
export class IndicadoresController {
  constructor(@Inject(CONSULTAR_INDICADORES) private readonly consultar: ConsultarIndicadoresUseCase) {}

  @Get()
  @ApiOperation({ summary: 'RF-19: atendidos, cancelados, ausentes, espera y atención promedio por agencia y total' })
  indicadores(@PrincipalActual() actor: Principal, @Query() q: IndicadoresQuery, @Req() req: Request) {
    return this.consultar.ejecutar(actor, {
      agenciaId: q.agenciaId,
      desde: q.desde?.slice(0, 10),
      hasta: q.hasta?.slice(0, 10),
      ip: req.ip,
    });
  }
}
