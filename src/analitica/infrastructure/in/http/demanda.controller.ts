import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiProperty, ApiPropertyOptional, ApiTags, PartialType } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional, IsUUID, Matches } from 'class-validator';
import type { Request } from 'express';
import type { Principal } from '../../../../compartido/domain/principal';
import { JwtAuthGuard } from '../../../../compartido/infrastructure/auth/jwt-auth.guard';
import { PrincipalActual, Roles, RolesGuard } from '../../../../compartido/infrastructure/auth/roles';
import {
  type CalendarioDemanda, type DatosEventoAgencia, type DiaDemanda, ESTADOS_PRONOSTICO,
  type EventoAgencia, NIVELES_DEMANDA, type TableroMensual, TIPOS_EVENTO_AGENCIA, type TipoEventoAgencia,
} from '../../../application/ports/out/demanda.port';
import { GestionarDemandaService } from '../../../application/use-cases/gestionar-demanda.service';
import { IndicadoresAgenciaDto, ValoresIndicadoresDto } from './indicadores.controller';

export class MesDemandaDto {
  @ApiProperty({ example: '2026-11' })
  @Matches(/^(?!0000)\d{4}-(?:0[1-9]|1[0-2])$/, { message: 'El mes debe tener formato AAAA-MM' })
  mes!: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  servicioId?: string;
}

export class TableroMensualQuery extends MesDemandaDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'El superadministrador puede omitir la agencia para ver el total general' })
  @IsOptional()
  @IsUUID()
  agenciaId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  colaboradorId?: string;
}

class FiltrosAnaliticaQuery {
  @ApiProperty({ format: 'date' })
  @Matches(/^(?!0000)\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  desde!: string;

  @ApiProperty({ format: 'date' })
  @Matches(/^(?!0000)\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  hasta!: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  agenciaId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  servicioId?: string;
}

class OpcionIndicadorDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() nombre!: string;
}

class OpcionColaboradorDto extends OpcionIndicadorDto {
  @ApiProperty({ type: [String] }) agenciaIds!: string[];
}

class FiltrosAnaliticaDto {
  @ApiProperty({ type: [OpcionIndicadorDto] }) servicios!: OpcionIndicadorDto[];
  @ApiProperty({ type: [OpcionColaboradorDto] }) colaboradores!: OpcionColaboradorDto[];
}

export class DatosEventoAgenciaDto implements DatosEventoAgencia {
  @ApiProperty({ format: 'date', example: '2026-11-20' })
  @Matches(/^(?!0000)\d{4}-\d{2}-\d{2}$/, { message: 'La fecha debe tener formato AAAA-MM-DD' })
  @IsDateString({ strict: true })
  fecha!: string;

  @ApiProperty({ enum: TIPOS_EVENTO_AGENCIA })
  @IsIn(TIPOS_EVENTO_AGENCIA)
  tipo!: TipoEventoAgencia;
}

export class CambiosEventoAgenciaDto extends PartialType(DatosEventoAgenciaDto, { skipNullProperties: false }) {}

class EventoAgenciaDto extends DatosEventoAgenciaDto implements EventoAgencia {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiPropertyOptional({ format: 'uuid' }) agenciaId?: string;
  @ApiPropertyOptional() agenciaNombre?: string;
}

class DiaDemandaDto implements DiaDemanda {
  @ApiProperty({ format: 'date' }) fecha!: string;
  @ApiProperty() diaHabil!: boolean;
  @ApiProperty() finDeSemana!: boolean;
  @ApiProperty({ type: String, nullable: true }) festivoNacional!: string | null;
  @ApiProperty({ type: [String] }) festivosPutumayo!: string[];
  @ApiProperty() vencimientoCredito!: boolean;
  @ApiProperty({ type: [EventoAgenciaDto] }) eventos!: EventoAgencia[];
  @ApiProperty({ type: 'integer', nullable: true }) turnosRegistrados!: number | null;
  @ApiProperty({ type: 'integer', nullable: true }) turnosEstimados!: number | null;
  @ApiProperty({ enum: NIVELES_DEMANDA, nullable: true }) nivelDemanda!: DiaDemanda['nivelDemanda'];
}

class CalendarioDemandaDto implements CalendarioDemanda {
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) agenciaId!: string | null;
  @ApiProperty({ example: '2026-11' }) mes!: string;
  @ApiProperty({ enum: ['REAL', 'SIMULADA'] }) fuente!: CalendarioDemanda['fuente'];
  @ApiProperty({ enum: ESTADOS_PRONOSTICO }) estadoPronostico!: CalendarioDemanda['estadoPronostico'];
  @ApiProperty({ type: [DiaDemandaDto] }) dias!: DiaDemanda[];
}

class TableroMensualDto implements TableroMensual {
  @ApiProperty({ enum: ['REAL', 'SIMULADA'] }) fuente!: TableroMensual['fuente'];
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) actualizadoEn!: string | null;
  @ApiProperty({ format: 'date' }) desde!: string;
  @ApiProperty({ format: 'date' }) hasta!: string;
  @ApiProperty({ type: ValoresIndicadoresDto }) resumen!: ValoresIndicadoresDto;
  @ApiProperty({ type: [IndicadoresAgenciaDto] }) agencias!: IndicadoresAgenciaDto[];
  @ApiProperty({ type: CalendarioDemandaDto }) calendario!: CalendarioDemandaDto;
}

@ApiTags('analítica')
@ApiBearerAuth()
@Controller('analitica')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPERADMIN', 'ADMIN_AGENCIA')
export class TableroMensualController {
  constructor(private readonly demanda: GestionarDemandaService) {}

  @Get('tablero')
  @ApiOkResponse({ type: TableroMensualDto })
  tablero(@PrincipalActual() actor: Principal, @Query() consulta: TableroMensualQuery, @Req() req: Request) {
    return this.demanda.tablero(actor, consulta.mes, consulta.agenciaId?.toLowerCase(), req.ip, {
      servicioId: consulta.servicioId?.toLowerCase(), colaboradorId: consulta.colaboradorId?.toLowerCase(),
    });
  }

  @Get('filtros')
  @ApiOkResponse({ type: FiltrosAnaliticaDto })
  filtros(@PrincipalActual() actor: Principal, @Query() consulta: FiltrosAnaliticaQuery, @Req() req: Request) {
    return this.demanda.opciones(actor, { desde: consulta.desde, hasta: consulta.hasta },
      consulta.agenciaId?.toLowerCase(), consulta.servicioId?.toLowerCase(), req.ip);
  }
}

@ApiTags('analítica')
@ApiBearerAuth()
@Controller('analitica/agencias/:agenciaId')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPERADMIN', 'ADMIN_AGENCIA')
export class DemandaController {
  constructor(private readonly demanda: GestionarDemandaService) {}

  @Get('demanda')
  @ApiOkResponse({ type: CalendarioDemandaDto })
  calendario(@PrincipalActual() actor: Principal, @Param('agenciaId', ParseUUIDPipe) agenciaId: string,
    @Query() consulta: MesDemandaDto, @Req() req: Request) {
    return this.demanda.calendario(actor, agenciaId.toLowerCase(), consulta.mes, req.ip, consulta.servicioId?.toLowerCase());
  }

  @Post('eventos')
  @ApiCreatedResponse({ type: EventoAgenciaDto })
  crearEvento(@PrincipalActual() actor: Principal, @Param('agenciaId', ParseUUIDPipe) agenciaId: string,
    @Body() datos: DatosEventoAgenciaDto, @Req() req: Request) {
    return this.demanda.crearEvento(actor, agenciaId, datos, req.ip);
  }

  @Patch('eventos/:eventoId')
  @ApiOkResponse({ type: EventoAgenciaDto })
  editarEvento(@PrincipalActual() actor: Principal, @Param('agenciaId', ParseUUIDPipe) agenciaId: string,
    @Param('eventoId', ParseUUIDPipe) eventoId: string, @Body() cambios: CambiosEventoAgenciaDto, @Req() req: Request) {
    return this.demanda.editarEvento(actor, agenciaId, eventoId, cambios, req.ip);
  }

  @Delete('eventos/:eventoId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  eliminarEvento(@PrincipalActual() actor: Principal, @Param('agenciaId', ParseUUIDPipe) agenciaId: string,
    @Param('eventoId', ParseUUIDPipe) eventoId: string, @Req() req: Request) {
    return this.demanda.eliminarEvento(actor, agenciaId, eventoId, req.ip);
  }
}
