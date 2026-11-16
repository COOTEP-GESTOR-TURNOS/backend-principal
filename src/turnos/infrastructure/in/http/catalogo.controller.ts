import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../../compartido/infrastructure/auth/jwt-auth.guard';
import {
  CONSULTAR_CATALOGO,
  type ConsultarCatalogoUseCase,
} from '../../../application/ports/in/consultar-catalogo.use-case';

@ApiTags('catálogo')
@ApiBearerAuth()
@Controller('agencias')
@UseGuards(JwtAuthGuard)
export class CatalogoController {
  constructor(@Inject(CONSULTAR_CATALOGO) private readonly catalogo: ConsultarCatalogoUseCase) {}

  @Get()
  @ApiOperation({ summary: 'RF-06: agencias con sus servicios y ventanillas' })
  listar() {
    return this.catalogo.listarAgencias();
  }
}
