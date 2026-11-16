import { Module } from '@nestjs/common';
import { AUDIT_LOG, type AuditLogPort } from '../auditoria/application/ports/out/audit-log.port';
import { AuditoriaModule } from '../auditoria/auditoria.module';
import { leerConfig } from '../compartido/infrastructure/config';
import { AUTENTICACION, type AutenticacionUseCase } from './application/ports/in/autenticacion.use-case';
import { CUENTAS } from './application/ports/in/cuentas.use-case';
import { INICIO_FEDERADO } from './application/ports/in/inicio-federado.use-case';
import {
  IDENTITY_PROVIDER,
  type IdentityProviderPort,
  PASSWORD_HASHER,
  type PasswordHasherPort,
} from './application/ports/out/identidad.ports';
import {
  CIFRADOR,
  type CifradorPort,
  CORREO,
  type CorreoPort,
  EMISOR_TOKENS,
  type EmisorTokensPort,
  TOTP,
  type TotpPort,
} from './application/ports/out/seguridad.ports';
import {
  ALMACEN_TEMPORAL,
  type AlmacenTemporalPort,
  LIMITADOR,
  type LimitadorPort,
  SESIONES,
  type SesionesPort,
} from './application/ports/out/sesiones.port';
import { USUARIO_REPOSITORY, type UsuarioRepository } from './application/ports/out/usuario.repository';
import { AutenticacionService } from './application/use-cases/autenticacion.service';
import { CuentasService } from './application/use-cases/cuentas.service';
import { InicioFederadoService } from './application/use-cases/inicio-federado.service';
import { AuthController } from './infrastructure/in/http/auth.controller';
import { Argon2PasswordAdapter } from './infrastructure/out/argon2-password.adapter';
import { SmtpCorreoAdapter } from './infrastructure/out/correo/smtp-correo.adapter';
import { GoogleOidcAdapter } from './infrastructure/out/oidc/google-oidc.adapter';
import { UsuarioPgRepository } from './infrastructure/out/postgres/usuario-pg.repository';
import { AlmacenTemporalRedisAdapter } from './infrastructure/out/redis/almacen-temporal-redis.adapter';
import { LimitadorRedisAdapter } from './infrastructure/out/redis/limitador-redis.adapter';
import { SesionesRedisAdapter } from './infrastructure/out/redis/sesiones-redis.adapter';
import { AesGcmAdapter } from './infrastructure/out/seguridad/aes-gcm.adapter';
import { EmisorJwtAdapter } from './infrastructure/out/seguridad/emisor-jwt.adapter';
import { TotpAdapter } from './infrastructure/out/seguridad/totp.adapter';

/**
 * Cableado del hexágono de identidad: PostgreSQL guarda cuentas y roles, Redis las sesiones,
 * retos y límites, Cassandra la auditoría y SMTP los correos. Los casos de uso se crean con
 * useFactory para que application/ no dependa de NestJS.
 */
@Module({
  imports: [AuditoriaModule],
  controllers: [AuthController],
  providers: [
    { provide: PASSWORD_HASHER, useClass: Argon2PasswordAdapter },
    { provide: IDENTITY_PROVIDER, useClass: GoogleOidcAdapter },
    { provide: USUARIO_REPOSITORY, useClass: UsuarioPgRepository },
    { provide: SESIONES, useClass: SesionesRedisAdapter },
    { provide: ALMACEN_TEMPORAL, useClass: AlmacenTemporalRedisAdapter },
    { provide: LIMITADOR, useClass: LimitadorRedisAdapter },
    { provide: EMISOR_TOKENS, useClass: EmisorJwtAdapter },
    { provide: TOTP, useClass: TotpAdapter },
    { provide: CIFRADOR, useClass: AesGcmAdapter },
    { provide: CORREO, useClass: SmtpCorreoAdapter },
    {
      provide: AUTENTICACION,
      useFactory: (
        usuarios: UsuarioRepository,
        hasher: PasswordHasherPort,
        sesiones: SesionesPort,
        almacen: AlmacenTemporalPort,
        limitador: LimitadorPort,
        emisor: EmisorTokensPort,
        totp: TotpPort,
        cifrador: CifradorPort,
        auditoria: AuditLogPort,
      ) => new AutenticacionService(usuarios, hasher, sesiones, almacen, limitador, emisor, totp, cifrador, auditoria),
      inject: [USUARIO_REPOSITORY, PASSWORD_HASHER, SESIONES, ALMACEN_TEMPORAL, LIMITADOR, EMISOR_TOKENS, TOTP, CIFRADOR, AUDIT_LOG],
    },
    {
      provide: CUENTAS,
      useFactory: (
        usuarios: UsuarioRepository,
        hasher: PasswordHasherPort,
        sesiones: SesionesPort,
        almacen: AlmacenTemporalPort,
        limitador: LimitadorPort,
        correo: CorreoPort,
        auditoria: AuditLogPort,
      ) => new CuentasService(usuarios, hasher, sesiones, almacen, limitador, correo, auditoria, leerConfig().urlPublica),
      inject: [USUARIO_REPOSITORY, PASSWORD_HASHER, SESIONES, ALMACEN_TEMPORAL, LIMITADOR, CORREO, AUDIT_LOG],
    },
    {
      provide: INICIO_FEDERADO,
      useFactory: (
        proveedor: IdentityProviderPort,
        usuarios: UsuarioRepository,
        almacen: AlmacenTemporalPort,
        autenticacion: AutenticacionUseCase,
      ) => new InicioFederadoService(proveedor, usuarios, almacen, autenticacion),
      inject: [IDENTITY_PROVIDER, USUARIO_REPOSITORY, ALMACEN_TEMPORAL, AUTENTICACION],
    },
  ],
  // La administración de usuarios reutiliza el repositorio, las sesiones y el envío de activaciones.
  exports: [PASSWORD_HASHER, USUARIO_REPOSITORY, SESIONES, CUENTAS],
})
export class IdentidadModule {}
