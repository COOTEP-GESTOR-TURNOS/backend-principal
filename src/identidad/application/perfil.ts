import { asignacionesParaToken, type CuentaUsuario } from '../domain/usuario';
import type { PerfilUsuario } from './ports/in/autenticacion.use-case';

/** Vista pública de la cuenta: nunca incluye el hash de la contraseña ni el secreto MFA. */
export function aPerfil(c: CuentaUsuario): PerfilUsuario {
  return {
    id: c.id,
    email: c.email,
    nombre: c.nombre,
    tipoDocumento: c.tipoDocumento,
    numeroDocumento: c.numeroDocumento,
    fechaNacimiento: c.fechaNacimiento,
    roles: asignacionesParaToken(c.roles),
    mfaActivo: c.mfaSecretoCifrado !== null,
    tienePassword: c.passwordHash !== null,
    perfilCompleto: c.tipoDocumento !== null && c.numeroDocumento !== null,
  };
}
