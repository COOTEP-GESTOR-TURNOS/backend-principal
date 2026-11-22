import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { Principal } from '../../../../compartido/domain/principal';
import { JwtAuthGuard } from '../../../../compartido/infrastructure/auth/jwt-auth.guard';
import { PrincipalActual, Roles, RolesGuard } from '../../../../compartido/infrastructure/auth/roles';
import {
  ATENDER_TURNO,
  AtenderTurnoUseCase,
  CONFIRMAR_PRESENCIA,
  ConfirmarPresenciaUseCase,
} from '../../../application/ports/in/atender-turno.use-case';
import { CANCELAR_TURNO, CancelarTurnoUseCase } from '../../../application/ports/in/cancelar-turno.use-case';
import {
  CONSULTAR_MI_TURNO,
  ConsultarMiTurnoUseCase,
} from '../../../application/ports/in/consultar-mi-turno.use-case';
import {
  CONSULTAR_VENTANILLA,
  ConsultarVentanillaUseCase,
} from '../../../application/ports/in/consultar-ventanilla.use-case';
import { SOLICITAR_TURNO, SolicitarTurnoUseCase } from '../../../application/ports/in/solicitar-turno.use-case';
import { MiTurnoDto, ResumenTurnoDto, SolicitarTurnoDto, VerificarPreferencialDto } from './dtos';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Adaptador de entrada REST. Solo traduce HTTP a comandos: las reglas están en los casos de uso,
 * a los que llega por sus puertos de entrada (tokens), nunca por las clases concretas.
 */
@ApiTags('turnos')
@ApiBearerAuth()
@Controller('turnos')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TurnosController {
  constructor(
    @Inject(SOLICITAR_TURNO) private readonly solicitar: SolicitarTurnoUseCase,
    @Inject(CANCELAR_TURNO) private readonly cancelar: CancelarTurnoUseCase,
    @Inject(CONSULTAR_MI_TURNO) private readonly consultar: ConsultarMiTurnoUseCase,
    @Inject(CONSULTAR_VENTANILLA) private readonly ventanilla: ConsultarVentanillaUseCase,
    @Inject(CONFIRMAR_PRESENCIA) private readonly confirmar: ConfirmarPresenciaUseCase,
    @Inject(ATENDER_TURNO) private readonly atender: AtenderTurnoUseCase,
  ) {}

  @Post()
  @Roles('ASOCIADO')
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'UUID; repetirlo devuelve el mismo turno' })
  @ApiOkResponse({ type: ResumenTurnoDto })
  solicitarTurno(
    @Body() dto: SolicitarTurnoDto,
    @Headers('idempotency-key') clave: string | undefined,
    @PrincipalActual() principal: Principal,
  ) {
    if (!clave || !UUID.test(clave)) {
      throw new BadRequestException('La cabecera Idempotency-Key (UUID) es obligatoria');
    }
    return this.solicitar.ejecutar({
      asociadoId: principal.id,
      agenciaId: dto.agenciaId,
      servicioId: dto.servicioId,
      solicitaPreferencial: dto.solicitaPreferencial ?? false,
      canal: dto.canal,
      idempotencyKey: clave,
    });
  }

  @Get('mio')
  @Roles('ASOCIADO')
  @ApiOkResponse({ type: MiTurnoDto })
  async miTurno(@PrincipalActual() principal: Principal) {
    const turno = await this.consultar.ejecutar(principal.id);
    if (!turno) throw new NotFoundException('No tienes un turno activo');
    return turno;
  }

  @Get('en-ventanilla')
  @Roles('FUNCIONARIO', 'ADMIN_AGENCIA')
  @ApiOperation({ summary: 'CU-04: el turno que el funcionario tiene llamado o en atención' })
  @ApiOkResponse({ type: ResumenTurnoDto })
  @ApiNoContentResponse({ description: 'No tiene turno en ventanilla' })
  async enVentanilla(@PrincipalActual() principal: Principal, @Res({ passthrough: true }) respuesta: Response) {
    const turno = await this.ventanilla.ejecutar(principal);
    if (!turno) {
      respuesta.status(204);
      return undefined;
    }
    return turno;
  }

  @Post(':id/cancelar')
  @HttpCode(200)
  @Roles('ASOCIADO')
  @ApiOkResponse({ type: ResumenTurnoDto })
  cancelarTurno(@Param('id', new ParseUUIDPipe()) id: string, @PrincipalActual() principal: Principal) {
    return this.cancelar.ejecutar({ turnoId: id, solicitante: principal });
  }

  @Post(':id/confirmar')
  @HttpCode(200)
  @Roles('ASOCIADO')
  @ApiOkResponse({ type: ResumenTurnoDto })
  confirmarPresencia(@Param('id', new ParseUUIDPipe()) id: string, @PrincipalActual() principal: Principal) {
    return this.confirmar.ejecutar(id, principal);
  }

  @Post(':id/iniciar')
  @HttpCode(200)
  @Roles('FUNCIONARIO', 'ADMIN_AGENCIA')
  @ApiOkResponse({ type: ResumenTurnoDto })
  iniciar(@Param('id', new ParseUUIDPipe()) id: string, @PrincipalActual() principal: Principal) {
    return this.atender.ejecutar({ turnoId: id, accion: 'INICIAR', funcionario: principal });
  }

  @Post(':id/finalizar')
  @HttpCode(200)
  @Roles('FUNCIONARIO', 'ADMIN_AGENCIA')
  @ApiOkResponse({ type: ResumenTurnoDto })
  finalizar(@Param('id', new ParseUUIDPipe()) id: string, @PrincipalActual() principal: Principal) {
    return this.atender.ejecutar({ turnoId: id, accion: 'FINALIZAR', funcionario: principal });
  }

  @Post(':id/ausente')
  @HttpCode(200)
  @Roles('FUNCIONARIO', 'ADMIN_AGENCIA')
  @ApiOkResponse({ type: ResumenTurnoDto })
  ausente(@Param('id', new ParseUUIDPipe()) id: string, @PrincipalActual() principal: Principal) {
    return this.atender.ejecutar({ turnoId: id, accion: 'AUSENTE', funcionario: principal });
  }

  @Post(':id/verificar-preferencial')
  @HttpCode(200)
  @Roles('FUNCIONARIO', 'ADMIN_AGENCIA')
  @ApiOkResponse({ type: ResumenTurnoDto })
  verificarPreferencial(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: VerificarPreferencialDto,
    @PrincipalActual() principal: Principal,
  ) {
    return this.atender.ejecutar({
      turnoId: id,
      accion: 'VERIFICAR_PREFERENCIAL',
      funcionario: principal,
      cumplePreferencial: dto.cumple,
    });
  }
}
