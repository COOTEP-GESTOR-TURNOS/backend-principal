import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { NoAutenticadoError } from '../../../../compartido/application/errores-aplicacion';
import type { Principal } from '../../../../compartido/domain/principal';
import { JwtAuthGuard } from '../../../../compartido/infrastructure/auth/jwt-auth.guard';
import { PrincipalActual } from '../../../../compartido/infrastructure/auth/roles';
import { VerificadorTokens } from '../../../../compartido/infrastructure/auth/verificador-tokens';
import { leerConfig } from '../../../../compartido/infrastructure/config';
import {
  AUTENTICACION,
  type AutenticacionUseCase,
  type ResultadoIngreso,
  type SesionEmitida,
} from '../../../application/ports/in/autenticacion.use-case';
import { CUENTAS, type CuentasUseCase } from '../../../application/ports/in/cuentas.use-case';
import { INICIO_FEDERADO, type InicioFederadoUseCase } from '../../../application/ports/in/inicio-federado.use-case';
import { esProveedorOidc, type ProveedorOidc } from '../../../application/ports/out/identidad.ports';
import type { Cliente } from '../../../application/ports/out/sesiones.port';
import {
  borrarCookieSesion,
  CABECERA_CSRF,
  clienteDe,
  fijarCookieSesion,
  tokenRenovacionDe,
} from './cookie-sesion';
import {
  ActualizarPerfilDto,
  CambiarClaveDto,
  CanjeDto,
  ClaveInicialDto,
  CorreoDto,
  LoginDto,
  RegistroDto,
  RenovacionDto,
  RestablecerDto,
  RetoDto,
  TokenDto,
  VerificarMfaDto,
} from './dtos';

/** Esquema de la app móvil (app.json → scheme) para volver del navegador después de Google. */
const ESQUEMA_MOVIL = 'cootepturno://oidc';

const ACEPTADO = { mensaje: 'Si la dirección está registrada, te enviamos un correo con las instrucciones.' };

/**
 * Adaptador de entrada REST de identidad (sección 9 del informe). Traduce HTTP a los casos de uso;
 * aquí solo se decide dónde viaja la renovación: cookie HttpOnly en la web, cuerpo en el móvil.
 */
@ApiTags('identidad')
@ApiHeader({ name: 'X-Cliente', required: false, description: '"movil" para recibir los tokens en el cuerpo' })
@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AUTENTICACION) private readonly autenticacion: AutenticacionUseCase,
    @Inject(CUENTAS) private readonly cuentas: CuentasUseCase,
    @Inject(INICIO_FEDERADO) private readonly federado: InicioFederadoUseCase,
    private readonly tokens: VerificadorTokens,
  ) {}

  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'RF-01: correo y contraseña. Puede pedir cambiar la clave o MFA antes de abrir la sesión' })
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const cliente = clienteDe(req);
    const resultado = await this.autenticacion.iniciarSesion({ correo: dto.correo, clave: dto.clave, ip: req.ip ?? '', cliente });
    return this.responder(resultado, cliente, res);
  }

  @Post('clave-inicial')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cambia la contraseña temporal durante el primer ingreso' })
  async claveInicial(@Body() dto: ClaveInicialDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.responder(await this.autenticacion.cambiarClaveInicial(dto), clienteDe(req), res);
  }

  @Post('mfa/configurar')
  @HttpCode(200)
  @ApiOperation({ summary: 'RF-03: genera el secreto TOTP y su código QR para la app autenticadora' })
  configurarMfa(@Body() dto: RetoDto) {
    return this.autenticacion.prepararMfa(dto.reto);
  }

  @Post('mfa/verificar')
  @HttpCode(200)
  @ApiOperation({ summary: 'RF-03: valida el código TOTP (al configurarlo o en cada ingreso)' })
  async verificarMfa(@Body() dto: VerificarMfaDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const resultado = await this.autenticacion.verificarMfa({ reto: dto.reto, codigo: dto.codigo, ip: req.ip ?? '' });
    return this.responder(resultado, clienteDe(req), res);
  }

  @Post('renovar')
  @HttpCode(200)
  @ApiHeader({ name: CABECERA_CSRF, required: false, description: 'Web: "1" (anti-CSRF)' })
  @ApiOperation({ summary: 'Entrega un token de acceso nuevo y rota la renovación' })
  async renovar(@Body() dto: RenovacionDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const cliente = clienteDe(req);
    const token = tokenRenovacionDe(req, dto.tokenRenovacion);
    try {
      if (!token) throw new NoAutenticadoError('SIN_SESION', 'No hay una sesión abierta');
      return this.responder({ estado: 'SESION_INICIADA', sesion: await this.autenticacion.renovar(token) }, cliente, res);
    } catch (error) {
      if (cliente === 'web') borrarCookieSesion(res);
      throw error;
    }
  }

  @Post('cerrar-sesion')
  @HttpCode(204)
  @ApiOperation({ summary: 'RF-05: borra la renovación y revoca el token de acceso hasta que venza' })
  async cerrarSesion(@Body() dto: RenovacionDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const tokenRenovacion = tokenRenovacionDe(req, dto.tokenRenovacion);
    const [tipo, acceso] = (req.header('authorization') ?? '').split(' ');
    const leido = tipo === 'Bearer' && acceso ? await this.tokens.leer(acceso).catch(() => null) : null;
    await this.autenticacion.cerrarSesion({ tokenRenovacion, acceso: leido ?? undefined });
    if (clienteDe(req) === 'web') borrarCookieSesion(res);
  }

  @Get('yo')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Perfil y roles de la sesión actual' })
  yo(@PrincipalActual() principal: Principal) {
    return this.autenticacion.perfil(principal.id);
  }

  @Patch('yo')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(204)
  @ApiOperation({ summary: 'Completa o corrige los datos propios (por ejemplo, el documento después de entrar con Google)' })
  actualizarPerfil(@PrincipalActual() principal: Principal, @Body() dto: ActualizarPerfilDto) {
    return this.cuentas.actualizarPerfil(principal.id, dto);
  }

  @Post('yo/clave')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(204)
  @ApiOperation({ summary: 'Cambia la contraseña propia' })
  cambiarClave(@PrincipalActual() principal: Principal, @Body() dto: CambiarClaveDto) {
    return this.cuentas.cambiarClave(principal.id, dto);
  }

  @Post('registro')
  @HttpCode(201)
  @ApiOperation({ summary: 'Registro público de asociados; envía un enlace para confirmar el correo' })
  async registro(@Body() dto: RegistroDto) {
    const { email } = await this.cuentas.registrar(dto);
    return { email, mensaje: 'Cuenta creada. Revisa tu correo para confirmarlo antes de ingresar.' };
  }

  @Post('verificar-correo')
  @HttpCode(204)
  verificarCorreo(@Body() dto: TokenDto) {
    return this.cuentas.verificarCorreo(dto.token);
  }

  @Post('verificar-correo/reenviar')
  @HttpCode(202)
  async reenviarVerificacion(@Body() dto: CorreoDto) {
    await this.cuentas.reenviarVerificacion(dto.correo);
    return ACEPTADO;
  }

  @Post('recuperar')
  @HttpCode(202)
  @ApiOperation({ summary: 'RF-04: envía un enlace de un solo uso (15 min). Responde igual exista o no la cuenta' })
  async recuperar(@Body() dto: CorreoDto) {
    await this.cuentas.solicitarRecuperacion(dto.correo);
    return ACEPTADO;
  }

  @Post('restablecer')
  @HttpCode(204)
  @ApiOperation({ summary: 'RF-04: fija la contraseña con el enlace de recuperación o de activación' })
  restablecer(@Body() dto: RestablecerDto) {
    return this.cuentas.restablecerClave(dto);
  }

  @Get('oidc/:proveedor/inicio')
  @ApiOperation({ summary: 'RF-02: redirige a Google (código de autorización + PKCE)' })
  async inicioOidc(@Param('proveedor') proveedor: string, @Query('cliente') cliente: string | undefined, @Res() res: Response) {
    const url = await this.federado.iniciar(this.proveedor(proveedor), cliente === 'movil' ? 'movil' : 'web');
    res.redirect(302, url);
  }

  @Get('oidc/:proveedor/callback')
  @ApiOperation({ summary: 'RF-02: retorno de Google; abre la sesión o pide MFA y vuelve a la web o a la app' })
  async callbackOidc(
    @Param('proveedor') proveedor: string,
    @Query() query: { code?: string; state?: string; error?: string },
    @Res() res: Response,
  ) {
    const web = `${leerConfig().urlPublica}/ingresar`;
    if (query.error || !query.code || !query.state) {
      return res.redirect(302, `${web}?error=${encodeURIComponent(query.error ?? 'OIDC_CANCELADO')}`);
    }
    try {
      const { cliente, resultado, codigoCanje } = await this.federado.completar({
        proveedor: this.proveedor(proveedor),
        codigo: query.code,
        state: query.state,
      });
      const destino = cliente === 'movil' ? ESQUEMA_MOVIL : web;
      if (resultado.estado === 'PASO_PENDIENTE') {
        return res.redirect(302, `${destino}?${new URLSearchParams({ reto: resultado.reto, paso: resultado.paso })}`);
      }
      if (cliente === 'movil') return res.redirect(302, `${destino}?codigo=${codigoCanje}`);
      fijarCookieSesion(res, resultado.sesion.tokenRenovacion);
      return res.redirect(302, `${destino}?oidc=ok`);
    } catch (error) {
      const codigo = (error as { codigo?: string }).codigo ?? 'OIDC_FALLIDO';
      return res.redirect(302, `${web}?error=${encodeURIComponent(codigo)}`);
    }
  }

  @Post('oidc/canjear')
  @HttpCode(200)
  @ApiOperation({ summary: 'Móvil: cambia el código de un minuto por los tokens de la sesión' })
  async canjear(@Body() dto: CanjeDto) {
    return this.cuerpoSesion(await this.federado.canjear(dto.codigo), 'movil');
  }

  private proveedor(valor: string): ProveedorOidc {
    if (!esProveedorOidc(valor)) throw new NotFoundException(`Proveedor no disponible: ${valor}`);
    return valor;
  }

  private responder(resultado: ResultadoIngreso, cliente: Cliente, res: Response) {
    if (resultado.estado === 'PASO_PENDIENTE') return resultado;
    if (cliente === 'web') fijarCookieSesion(res, resultado.sesion.tokenRenovacion);
    return { estado: resultado.estado, ...this.cuerpoSesion(resultado.sesion, cliente) };
  }

  /** La web nunca recibe la renovación en el cuerpo: solo en la cookie HttpOnly. */
  private cuerpoSesion(s: SesionEmitida, cliente: Cliente) {
    return {
      tokenAcceso: s.tokenAcceso,
      expiraEn: s.expiraEn,
      usuario: s.usuario,
      ...(cliente === 'movil' ? { tokenRenovacion: s.tokenRenovacion } : {}),
    };
  }
}
