import { Controller, Get, Inject, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, Matches, Max, MaxLength, Min } from 'class-validator';
import type { Principal } from '../../../../compartido/domain/principal';
import { JwtAuthGuard } from '../../../../compartido/infrastructure/auth/jwt-auth.guard';
import { PrincipalActual, Roles, RolesGuard } from '../../../../compartido/infrastructure/auth/roles';
import { CONSULTAR_AUDITORIA, type ConsultarAuditoriaUseCase } from '../../../application/ports/in/consultar-auditoria.use-case';
import { LIMITE_MAXIMO, LIMITE_POR_DEFECTO } from '../../../application/use-cases/consultar-auditoria.service';

const CURSOR_HEXADECIMAL = /^(?:[0-9a-f]{2})+$/i;

class PaginaQuery {
  @ApiPropertyOptional({ default: LIMITE_POR_DEFECTO, minimum: 1, maximum: LIMITE_MAXIMO })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(LIMITE_MAXIMO)
  limite?: number;

  @ApiPropertyOptional({ description: 'Valor siguiente de la página anterior. Conserva los mismos filtros.', maxLength: 2000 })
  @IsOptional()
  @Matches(CURSOR_HEXADECIMAL, { message: 'El valor de siguiente no es válido' })
  @MaxLength(2000)
  siguiente?: string;
}

export class AuditoriaAmbitoQuery extends PaginaQuery {
  @ApiProperty({ example: 'GLOBAL', description: 'GLOBAL o el id de una agencia' })
  @Matches(/^(GLOBAL|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i, { message: 'El ámbito es GLOBAL o el id de una agencia' })
  ambito!: string;

  @ApiPropertyOptional({ example: '2026-11-16', format: 'date', description: 'Día en hora de Colombia. Usa el mismo día al paginar.' })
  @IsOptional()
  @IsDateString({ strict: true })
  dia?: string;

  @ApiPropertyOptional({ example: 'INTENTO_FUERA_DE_AMBITO', description: 'Filtra las entradas de todas las páginas por acción.' })
  @IsOptional()
  @Matches(/^[A-Z_]{3,40}$/)
  accion?: string;
}

export class AuditoriaActorQuery extends PaginaQuery {
  @ApiPropertyOptional({ example: '2026-11', description: 'Mes AAAA-MM. Por defecto, el mes actual en Colombia.' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}$/)
  mes?: string;
}

class ActorAuditoriaDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, nullable: true })
  rol!: string | null;

  @ApiProperty({ type: String, nullable: true })
  nombre!: string | null;

  @ApiProperty({ type: String, nullable: true })
  email!: string | null;
}

class EntradaAuditoriaDto {
  @ApiProperty({ format: 'date-time' })
  ocurridoEn!: string;

  @ApiProperty()
  ambito!: string;

  @ApiProperty()
  accion!: string;

  @ApiProperty({ type: ActorAuditoriaDto })
  actor!: ActorAuditoriaDto;

  @ApiProperty({ type: String, nullable: true })
  objetivoTipo!: string | null;

  @ApiProperty()
  objetivoId!: string;

  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true })
  detalle!: Record<string, unknown> | null;

  @ApiProperty({ type: String, nullable: true })
  ip!: string | null;
}

class PaginaAuditoriaDto {
  @ApiProperty({ type: [EntradaAuditoriaDto] })
  entradas!: EntradaAuditoriaDto[];

  @ApiProperty({ type: String, nullable: true, description: 'Cursor para la próxima página, o null al terminar.' })
  siguiente!: string | null;

  @ApiProperty({ minimum: 1, maximum: LIMITE_MAXIMO })
  limite!: number;
}

class AuditoriaAmbitoDto extends PaginaAuditoriaDto {
  @ApiProperty()
  ambito!: string;

  @ApiProperty({ format: 'date' })
  dia!: string;
}

class AuditoriaActorDto extends PaginaAuditoriaDto {
  @ApiProperty({ format: 'uuid' })
  actorId!: string;

  @ApiProperty({ example: '2026-11' })
  mes!: string;
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
  @ApiOkResponse({ type: AuditoriaAmbitoDto })
  porAmbitoDia(@PrincipalActual() actor: Principal, @Query() q: AuditoriaAmbitoQuery) {
    return this.consultar.porAmbitoDia(actor, { ...q, dia: q.dia?.slice(0, 10) });
  }

  @Get('actores/:actorId')
  @ApiOperation({ summary: 'Qué hizo una persona en un mes (segunda tabla de consulta de Cassandra)' })
  @ApiOkResponse({ type: AuditoriaActorDto })
  porActorMes(@PrincipalActual() actor: Principal, @Param('actorId', new ParseUUIDPipe()) actorId: string, @Query() q: AuditoriaActorQuery) {
    return this.consultar.porActorMes(actor, { actorId, ...q });
  }
}
