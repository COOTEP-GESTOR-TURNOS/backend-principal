import { Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { Principal } from '../../../../compartido/domain/principal';
import { JwtAuthGuard } from '../../../../compartido/infrastructure/auth/jwt-auth.guard';
import { PrincipalActual, Roles, RolesGuard } from '../../../../compartido/infrastructure/auth/roles';
import { PaginacionQuery } from '../../../../compartido/infrastructure/http/paginacion.dto';
import { CONSULTAR_FILA, ConsultarFilaUseCase } from '../../../application/ports/in/consultar-fila.use-case';
import { LLAMAR_SIGUIENTE, LlamarSiguienteUseCase } from '../../../application/ports/in/llamar-siguiente.use-case';
import { PaginaTurnosDto, ResumenTurnoDto } from './dtos';

@ApiTags('filas')
@ApiBearerAuth()
@Controller('filas')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FilasController {
  constructor(
    @Inject(LLAMAR_SIGUIENTE) private readonly llamar: LlamarSiguienteUseCase,
    @Inject(CONSULTAR_FILA) private readonly consultar: ConsultarFilaUseCase,
  ) {}

  @Get(':agenciaId/:servicioId/turnos')
  @Roles('FUNCIONARIO', 'ADMIN_AGENCIA')
  @ApiOperation({ summary: 'Consulta la fila paginada en el orden del próximo llamado' })
  @ApiOkResponse({ type: PaginaTurnosDto })
  listar(
    @Param('agenciaId', new ParseUUIDPipe()) agenciaId: string,
    @Param('servicioId', new ParseUUIDPipe()) servicioId: string,
    @Query() paginacion: PaginacionQuery,
    @PrincipalActual() principal: Principal,
  ) {
    return this.consultar.ejecutar({ agenciaId, servicioId, funcionario: principal, ...paginacion });
  }

  @Post(':agenciaId/:servicioId/siguiente')
  @HttpCode(200)
  @Roles('FUNCIONARIO', 'ADMIN_AGENCIA')
  @ApiOkResponse({ type: ResumenTurnoDto })
  @ApiNoContentResponse({ description: 'La fila está vacía' })
  async llamarSiguiente(
    @Param('agenciaId', new ParseUUIDPipe()) agenciaId: string,
    @Param('servicioId', new ParseUUIDPipe()) servicioId: string,
    @PrincipalActual() principal: Principal,
    @Res({ passthrough: true }) respuesta: Response,
  ) {
    const turno = await this.llamar.ejecutar({ agenciaId, servicioId, funcionario: principal });
    if (!turno) {
      respuesta.status(204);
      return undefined;
    }
    return turno;
  }
}
