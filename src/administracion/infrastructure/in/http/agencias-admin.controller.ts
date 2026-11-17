import { Body, Controller, Delete, Get, Inject, Param, ParseUUIDPipe, Patch, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import type { Request } from 'express';
import type { Principal } from '../../../../compartido/domain/principal';
import { JwtAuthGuard } from '../../../../compartido/infrastructure/auth/jwt-auth.guard';
import { PrincipalActual, Roles, RolesGuard } from '../../../../compartido/infrastructure/auth/roles';
import { GESTIONAR_AGENCIAS, type GestionarAgenciasUseCase } from '../../../application/ports/in/gestionar-agencias.use-case';

const CLAVE = /^[A-Z_]{3,40}$/;

export class ActualizarServicioDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 20 })
  @IsOptional()
  @IsInt()
  ventanillas?: number;

  @ApiPropertyOptional({ description: 'false: la agencia deja de ofrecer el servicio' })
  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}

export class ValorParametroDto {
  @ApiProperty({ example: '3' })
  @IsString()
  @MaxLength(20)
  valor!: string;
}

export class ActualizarAgenciaDto {
  @ApiProperty()
  @IsBoolean()
  activa!: boolean;
}

/**
 * Adaptador de entrada REST de la gestión de agencias (sección 6 del informe: /admin/agencias y
 * /admin/parametros). El guard deja pasar a los dos roles; el ámbito lo decide el caso de uso.
 */
@ApiTags('administración')
@ApiBearerAuth()
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPERADMIN', 'ADMIN_AGENCIA')
export class AgenciasAdminController {
  constructor(@Inject(GESTIONAR_AGENCIAS) private readonly gestionar: GestionarAgenciasUseCase) {}

  @Get('agencias/:id')
  @ApiOperation({ summary: 'Servicios, ventanillas, horario y parámetros efectivos de la agencia' })
  obtener(@PrincipalActual() actor: Principal, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.gestionar.obtener(actor, id);
  }

  @Patch('agencias/:id')
  @Roles('SUPERADMIN')
  @ApiOperation({ summary: 'Abre o cierra la agencia completa (solo superadministrador)' })
  actualizarAgencia(@PrincipalActual() actor: Principal, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: ActualizarAgenciaDto, @Req() req: Request) {
    return this.gestionar.actualizarAgencia(actor, id, dto, req.ip);
  }

  @Patch('agencias/:id/servicios/:servicioId')
  @ApiOperation({ summary: 'Cambia las ventanillas o deja de ofrecer un servicio; la espera estimada se ajusta de inmediato' })
  actualizarServicio(
    @PrincipalActual() actor: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('servicioId', new ParseUUIDPipe()) servicioId: string,
    @Body() dto: ActualizarServicioDto,
    @Req() req: Request,
  ) {
    return this.gestionar.actualizarServicio(actor, id, servicioId, dto, req.ip);
  }

  @Put('agencias/:id/parametros/:clave')
  @ApiOperation({ summary: 'Fija un parámetro propio de la agencia (horario, K, N_PROXIMO, tiempos)' })
  fijarParametro(
    @PrincipalActual() actor: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('clave') clave: string,
    @Body() dto: ValorParametroDto,
    @Req() req: Request,
  ) {
    return this.gestionar.fijarParametro(actor, id, this.clave(clave), dto.valor, req.ip);
  }

  @Delete('agencias/:id/parametros/:clave')
  @ApiOperation({ summary: 'Quita el valor propio: la agencia vuelve a usar el global' })
  restablecerParametro(@PrincipalActual() actor: Principal, @Param('id', new ParseUUIDPipe()) id: string, @Param('clave') clave: string, @Req() req: Request) {
    return this.gestionar.restablecerParametro(actor, id, this.clave(clave), req.ip);
  }

  @Get('parametros')
  @Roles('SUPERADMIN')
  @ApiOperation({ summary: 'Parámetros globales (CU-06)' })
  parametrosGlobales(@PrincipalActual() actor: Principal) {
    return this.gestionar.parametrosGlobales(actor);
  }

  @Put('parametros/:clave')
  @Roles('SUPERADMIN')
  @ApiOperation({ summary: 'Cambia un parámetro global; afecta a las agencias que no lo sobrescriben' })
  fijarParametroGlobal(@PrincipalActual() actor: Principal, @Param('clave') clave: string, @Body() dto: ValorParametroDto, @Req() req: Request) {
    return this.gestionar.fijarParametroGlobal(actor, this.clave(clave), dto.valor, req.ip);
  }

  private clave(valor: string): string {
    const clave = valor.toUpperCase();
    return CLAVE.test(clave) ? clave : 'INVALIDA';
  }
}
