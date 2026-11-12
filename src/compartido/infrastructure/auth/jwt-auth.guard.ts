import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import type { Principal } from '../../domain/principal';
import { VerificadorTokens } from './verificador-tokens';

export type PeticionAutenticada = Request & { principal?: Principal };

/** Exige un token de acceso válido en la cabecera Authorization: Bearer <token>. */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly tokens: VerificadorTokens) {}

  async canActivate(contexto: ExecutionContext): Promise<boolean> {
    const peticion = contexto.switchToHttp().getRequest<PeticionAutenticada>();
    const [tipo, token] = (peticion.header('authorization') ?? '').split(' ');
    if (tipo !== 'Bearer' || !token) {
      throw new UnauthorizedException('Falta el token de acceso');
    }
    try {
      peticion.principal = await this.tokens.verificar(token);
      return true;
    } catch {
      throw new UnauthorizedException('Token inválido o vencido');
    }
  }
}
