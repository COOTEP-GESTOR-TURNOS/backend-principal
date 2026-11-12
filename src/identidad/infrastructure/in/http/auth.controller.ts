import { Controller, Get, HttpCode, NotImplementedException, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

const PENDIENTE = 'Pendiente de implementar: ver src/identidad/README.md';

/**
 * Contrato de identidad (sección 9 del informe). Los endpoints ya están en OpenAPI y
 * responden 501 hasta implementar el módulo. Mientras tanto, para probar, use
 * npm run demo:sembrar y npm run token:dev.
 */
@ApiTags('identidad')
@Controller('auth')
export class AuthController {
  @Post('login')
  @HttpCode(200)
  login() {
    throw new NotImplementedException(PENDIENTE);
  }

  @Post('mfa/verificar')
  @HttpCode(200)
  verificarMfa() {
    throw new NotImplementedException(PENDIENTE);
  }

  @Get('oidc/:proveedor/inicio')
  inicioOidc(@Param('proveedor') _proveedor: string) {
    throw new NotImplementedException(PENDIENTE);
  }

  @Get('oidc/:proveedor/callback')
  callbackOidc(@Param('proveedor') _proveedor: string) {
    throw new NotImplementedException(PENDIENTE);
  }

  @Post('renovar')
  @HttpCode(200)
  renovar() {
    throw new NotImplementedException(PENDIENTE);
  }

  @Post('cerrar-sesion')
  @HttpCode(204)
  cerrarSesion() {
    throw new NotImplementedException(PENDIENTE);
  }
}
