import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsUUID } from 'class-validator';
import { JwtAuthGuard } from '../../../../compartido/infrastructure/auth/jwt-auth.guard';
import {
  CONSULTAR_RECOMENDACIONES,
  type ConsultarRecomendacionesUseCase,
} from '../../../application/ports/in/consultar-recomendaciones.use-case';

export class RecomendacionesQuery {
  @ApiProperty()
  @IsUUID()
  agenciaId!: string;

  @ApiProperty()
  @IsUUID()
  servicioId!: string;

  @ApiPropertyOptional({ example: '2026-11-18', description: 'Por defecto, hoy en la hora de Colombia' })
  @IsOptional()
  @IsDateString({ strict: true })
  fecha?: string;
}

/** Adaptador de entrada REST de la recomendación de horario (sección 6 del informe: "Con sesión"). */
@ApiTags('analítica')
@ApiBearerAuth()
@Controller('recomendaciones')
@UseGuards(JwtAuthGuard)
export class RecomendacionesController {
  constructor(@Inject(CONSULTAR_RECOMENDACIONES) private readonly consultar: ConsultarRecomendacionesUseCase) {}

  @Get()
  @ApiOperation({ summary: 'RF-10: las franjas de 30 min con menor espera histórica para esa fila y día' })
  recomendar(@Query() q: RecomendacionesQuery) {
    return this.consultar.ejecutar({ agenciaId: q.agenciaId, servicioId: q.servicioId, fecha: q.fecha?.slice(0, 10) });
  }
}
