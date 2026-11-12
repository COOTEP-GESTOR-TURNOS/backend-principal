import { Module } from '@nestjs/common';
import { IDENTITY_PROVIDER, PASSWORD_HASHER } from './application/ports/out/identidad.ports';
import { AuthController } from './infrastructure/in/http/auth.controller';
import { Argon2PasswordAdapter } from './infrastructure/out/argon2-password.adapter';
import { OidcProviderAdapter } from './infrastructure/out/oidc-provider.adapter';

@Module({
  controllers: [AuthController],
  providers: [
    { provide: PASSWORD_HASHER, useClass: Argon2PasswordAdapter },
    { provide: IDENTITY_PROVIDER, useClass: OidcProviderAdapter },
  ],
  exports: [PASSWORD_HASHER, IDENTITY_PROVIDER],
})
export class IdentidadModule {}
