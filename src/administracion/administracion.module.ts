import { Module } from '@nestjs/common';
import { AUDIT_LOG, type AuditLogPort } from '../auditoria/application/ports/out/audit-log.port';
import { AuditoriaModule } from '../auditoria/auditoria.module';
import { CUENTAS, type CuentasUseCase } from '../identidad/application/ports/in/cuentas.use-case';
import { SESIONES, type SesionesPort } from '../identidad/application/ports/out/sesiones.port';
import { USUARIO_REPOSITORY, type UsuarioRepository } from '../identidad/application/ports/out/usuario.repository';
import { IdentidadModule } from '../identidad/identidad.module';
import { ADMINISTRAR_USUARIOS } from './application/ports/in/administrar-usuarios.use-case';
import { AdministrarUsuariosService } from './application/use-cases/administrar-usuarios.service';
import { UsuariosAdminController } from './infrastructure/in/http/usuarios-admin.controller';

/**
 * Administración (RF-17, RF-18). Reutiliza los puertos que exporta identidad: el repositorio de
 * cuentas, las sesiones (para cerrarlas al desactivar) y el caso de uso que envía la activación.
 */
@Module({
  imports: [IdentidadModule, AuditoriaModule],
  controllers: [UsuariosAdminController],
  providers: [
    {
      provide: ADMINISTRAR_USUARIOS,
      useFactory: (usuarios: UsuarioRepository, sesiones: SesionesPort, cuentas: CuentasUseCase, auditoria: AuditLogPort) =>
        new AdministrarUsuariosService(usuarios, sesiones, cuentas, auditoria),
      inject: [USUARIO_REPOSITORY, SESIONES, CUENTAS, AUDIT_LOG],
    },
  ],
})
export class AdministracionModule {}
