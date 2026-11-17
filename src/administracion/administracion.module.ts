import { Module } from '@nestjs/common';
import { AUDIT_LOG, type AuditLogPort } from '../auditoria/application/ports/out/audit-log.port';
import { AuditoriaModule } from '../auditoria/auditoria.module';
import { CUENTAS, type CuentasUseCase } from '../identidad/application/ports/in/cuentas.use-case';
import { SESIONES, type SesionesPort } from '../identidad/application/ports/out/sesiones.port';
import { USUARIO_REPOSITORY, type UsuarioRepository } from '../identidad/application/ports/out/usuario.repository';
import { IdentidadModule } from '../identidad/identidad.module';
import { INVALIDADOR_CATALOGO, type InvalidadorCatalogoPort } from '../turnos/application/ports/out/otros.ports';
import { TurnosModule } from '../turnos/turnos.module';
import { ADMINISTRAR_USUARIOS } from './application/ports/in/administrar-usuarios.use-case';
import { GESTIONAR_AGENCIAS } from './application/ports/in/gestionar-agencias.use-case';
import { AGENCIAS_ADMIN, type AgenciasAdminRepository } from './application/ports/out/agencias-admin.repository';
import { AdministrarUsuariosService } from './application/use-cases/administrar-usuarios.service';
import { GestionarAgenciasService } from './application/use-cases/gestionar-agencias.service';
import { AgenciasAdminController } from './infrastructure/in/http/agencias-admin.controller';
import { UsuariosAdminController } from './infrastructure/in/http/usuarios-admin.controller';
import { AgenciasAdminPgRepository } from './infrastructure/out/postgres/agencias-admin-pg.repository';

/**
 * Administración (RF-17, RF-18). Reutiliza los puertos que exporta identidad (cuentas, sesiones,
 * activación) y el invalidador de catálogo de turnos, para que un cambio de ventanillas o de
 * horario se note en la siguiente solicitud sin esperar a que venza la caché.
 */
@Module({
  imports: [IdentidadModule, AuditoriaModule, TurnosModule],
  controllers: [UsuariosAdminController, AgenciasAdminController],
  providers: [
    { provide: AGENCIAS_ADMIN, useClass: AgenciasAdminPgRepository },
    {
      provide: ADMINISTRAR_USUARIOS,
      useFactory: (usuarios: UsuarioRepository, sesiones: SesionesPort, cuentas: CuentasUseCase, auditoria: AuditLogPort) =>
        new AdministrarUsuariosService(usuarios, sesiones, cuentas, auditoria),
      inject: [USUARIO_REPOSITORY, SESIONES, CUENTAS, AUDIT_LOG],
    },
    {
      provide: GESTIONAR_AGENCIAS,
      useFactory: (agencias: AgenciasAdminRepository, invalidador: InvalidadorCatalogoPort, auditoria: AuditLogPort) =>
        new GestionarAgenciasService(agencias, invalidador, auditoria),
      inject: [AGENCIAS_ADMIN, INVALIDADOR_CATALOGO, AUDIT_LOG],
    },
  ],
})
export class AdministracionModule {}
