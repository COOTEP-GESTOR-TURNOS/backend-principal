import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Principal, Rol, tieneRol } from '../../domain/principal';
import type { PeticionAutenticada } from './jwt-auth.guard';

const CLAVE_ROLES = 'roles-permitidos';

/** Roles que pueden llamar al endpoint. El permiso sobre cada objeto lo revisa el caso de uso. */
export const Roles = (...roles: Rol[]) => SetMetadata(CLAVE_ROLES, roles);

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(contexto: ExecutionContext): boolean {
    const permitidos = this.reflector.getAllAndOverride<Rol[] | undefined>(CLAVE_ROLES, [
      contexto.getHandler(),
      contexto.getClass(),
    ]);
    if (!permitidos || permitidos.length === 0) return true;
    const principal = contexto.switchToHttp().getRequest<PeticionAutenticada>().principal;
    if (!principal || !tieneRol(principal, ...permitidos)) {
      throw new ForbiddenException('Tu rol no permite esta acción');
    }
    return true;
  }
}

/** Inyecta en el controlador el usuario autenticado por JwtAuthGuard. */
export const PrincipalActual = createParamDecorator((_dato: unknown, contexto: ExecutionContext): Principal => {
  const principal = contexto.switchToHttp().getRequest<PeticionAutenticada>().principal;
  if (!principal) throw new ForbiddenException('Sin sesión');
  return principal;
});
