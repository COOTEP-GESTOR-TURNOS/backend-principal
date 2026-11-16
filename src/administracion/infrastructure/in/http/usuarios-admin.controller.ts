import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { Principal } from '../../../../compartido/domain/principal';
import { JwtAuthGuard } from '../../../../compartido/infrastructure/auth/jwt-auth.guard';
import { PrincipalActual, Roles, RolesGuard } from '../../../../compartido/infrastructure/auth/roles';
import {
  ADMINISTRAR_USUARIOS,
  type AdministrarUsuariosUseCase,
} from '../../../application/ports/in/administrar-usuarios.use-case';
import { ActualizarUsuarioDto, AsignarRolDto, CrearUsuarioDto, ListarUsuariosQuery } from './dtos';

/**
 * Adaptador de entrada REST de la administración de usuarios. El guard deja pasar a los dos
 * roles administrativos; el ámbito de cada uno lo decide el caso de uso, objeto por objeto.
 */
@ApiTags('administración')
@ApiBearerAuth()
@Controller('admin/usuarios')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPERADMIN', 'ADMIN_AGENCIA')
export class UsuariosAdminController {
  constructor(@Inject(ADMINISTRAR_USUARIOS) private readonly administrar: AdministrarUsuariosUseCase) {}

  @Get()
  @ApiOperation({ summary: 'Usuarios de su ámbito, con búsqueda y paginación' })
  listar(@PrincipalActual() actor: Principal, @Query() q: ListarUsuariosQuery) {
    return this.administrar.listar(actor, q);
  }

  @Get(':id')
  obtener(@PrincipalActual() actor: Principal, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.administrar.obtener(actor, id);
  }

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Crea la cuenta con su rol y envía el enlace de activación por correo' })
  crear(@PrincipalActual() actor: Principal, @Body() dto: CrearUsuarioDto, @Req() req: Request) {
    const { rol, agenciaId, servicioId, ...datos } = dto;
    return this.administrar.crear(actor, { ...datos, rol: { rol, agenciaId, servicioId } }, req.ip);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edita los datos o activa y desactiva la cuenta' })
  actualizar(
    @PrincipalActual() actor: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ActualizarUsuarioDto,
    @Req() req: Request,
  ) {
    return this.administrar.actualizar(actor, id, dto, req.ip);
  }

  @Post(':id/roles')
  @HttpCode(201)
  asignarRol(
    @PrincipalActual() actor: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AsignarRolDto,
    @Req() req: Request,
  ) {
    return this.administrar.asignarRol(actor, id, dto, req.ip);
  }

  @Delete(':id/roles/:asignacionId')
  revocarRol(
    @PrincipalActual() actor: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('asignacionId', new ParseUUIDPipe()) asignacionId: string,
    @Req() req: Request,
  ) {
    return this.administrar.revocarRol(actor, id, asignacionId, req.ip);
  }

  @Post(':id/activacion')
  @HttpCode(204)
  @ApiOperation({ summary: 'Reenvía el enlace para definir la contraseña' })
  reenviarActivacion(@PrincipalActual() actor: Principal, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.administrar.reenviarActivacion(actor, id);
  }

  @Post(':id/mfa/restablecer')
  @HttpCode(204)
  @Roles('SUPERADMIN')
  @ApiOperation({ summary: 'Borra el MFA de la cuenta; deberá configurarlo de nuevo al ingresar' })
  restablecerMfa(@PrincipalActual() actor: Principal, @Param('id', new ParseUUIDPipe()) id: string, @Req() req: Request) {
    return this.administrar.restablecerMfa(actor, id, req.ip);
  }
}
