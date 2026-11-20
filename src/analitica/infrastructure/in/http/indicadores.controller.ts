import { Controller, Get, Inject, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsUUID } from 'class-validator';
import type { Request } from 'express';
import type { Principal } from '../../../../compartido/domain/principal';
import { JwtAuthGuard } from '../../../../compartido/infrastructure/auth/jwt-auth.guard';
import { PrincipalActual, Roles, RolesGuard } from '../../../../compartido/infrastructure/auth/roles';
import { PaginacionDto, PaginacionQuery } from '../../../../compartido/infrastructure/http/paginacion.dto';
import {
  CONSULTAR_INDICADORES,
  type ConsultarIndicadoresUseCase,
  type IndicadoresAgencia,
  type TableroIndicadores,
  type ValoresIndicadores,
} from '../../../application/ports/in/consultar-indicadores.use-case';

export class IndicadoresQuery extends PaginacionQuery {
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

class ValoresIndicadoresDto implements ValoresIndicadores {
  @ApiProperty() atendidos!: number;
  @ApiProperty() cancelados!: number;
  @ApiProperty() ausentes!: number;
  @ApiProperty() esperaPromedioMin!: number;
  @ApiProperty() atencionPromedioMin!: number;
  @ApiProperty() proporcionPreferencial!: number;
}

class IndicadoresAgenciaDto extends ValoresIndicadoresDto implements IndicadoresAgencia {
  @ApiProperty({ format: 'uuid' }) agenciaId!: string;
  @ApiProperty() nombre!: string;
  @ApiProperty() disponible!: boolean;
}

class TableroIndicadoresDto implements TableroIndicadores {
  @ApiProperty({ format: 'date' }) desde!: string;
  @ApiProperty({ format: 'date' }) hasta!: string;
  @ApiProperty({ enum: ['GLOBAL', 'AGENCIA'] }) ambito!: TableroIndicadores['ambito'];
  @ApiProperty({ type: [IndicadoresAgenciaDto] }) agencias!: IndicadoresAgenciaDto[];
  @ApiProperty({ type: ValoresIndicadoresDto, description: 'Indicadores de todas las agencias disponibles del ámbito y rango' })
  total!: ValoresIndicadoresDto;
  @ApiPropertyOptional({ type: PaginacionDto, description: 'Presente al enviar pagina o tamano; solo pagina la lista de agencias' })
  paginacion?: PaginacionDto;
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
  @ApiOkResponse({ type: TableroIndicadoresDto })
  indicadores(@PrincipalActual() actor: Principal, @Query() q: IndicadoresQuery, @Req() req: Request) {
    return this.consultar.ejecutar(actor, {
      agenciaId: q.agenciaId,
      desde: q.desde?.slice(0, 10),
      hasta: q.hasta?.slice(0, 10),
      pagina: q.pagina,
      tamano: q.tamano,
      ip: req.ip,
    });
  }
}
