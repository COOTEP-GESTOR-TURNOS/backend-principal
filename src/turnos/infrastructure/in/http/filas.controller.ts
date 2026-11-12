import { Controller, HttpCode, Inject, Param, ParseUUIDPipe, Post, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { Principal } from '../../../../compartido/domain/principal';
import { JwtAuthGuard } from '../../../../compartido/infrastructure/auth/jwt-auth.guard';
import { PrincipalActual, Roles, RolesGuard } from '../../../../compartido/infrastructure/auth/roles';
import { LLAMAR_SIGUIENTE, LlamarSiguienteUseCase } from '../../../application/ports/in/llamar-siguiente.use-case';
import { ResumenTurnoDto } from './dtos';

@ApiTags('filas')
@ApiBearerAuth()
@Controller('filas')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FilasController {
  constructor(@Inject(LLAMAR_SIGUIENTE) private readonly llamar: LlamarSiguienteUseCase) {}

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
