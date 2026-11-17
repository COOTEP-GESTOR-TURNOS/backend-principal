import { Module } from '@nestjs/common';
import { AUDIT_LOG, type AuditLogPort } from '../auditoria/application/ports/out/audit-log.port';
import { AuditoriaModule } from '../auditoria/auditoria.module';
import { CUENTAS, type CuentasUseCase } from '../identidad/application/ports/in/cuentas.use-case';
import { SESIONES, type SesionesPort } from '../identidad/application/ports/out/sesiones.port';
import { USUARIO_REPOSITORY, type UsuarioRepository } from '../identidad/application/ports/out/usuario.repository';
import { IdentidadModule } from '../identidad/identidad.module';
import { MOTOR_FILAS, type MotorFilasPort } from '../turnos/application/ports/out/motor-filas.port';
import {
  CATALOGO,
  type CatalogoPort,
  CERROJO,
  type CerrojoPort,
  EVENT_STORE,
  type EventStorePort,
  GENERADOR_IDS,
  type GeneradorIdsPort,
  INVALIDADOR_CATALOGO,
  type InvalidadorCatalogoPort,
  JORNADAS,
  type JornadasPort,
  NOTIFICADOR,
  type NotificadorPort,
  RELOJ,
  type RelojPort,
} from '../turnos/application/ports/out/otros.ports';
import { TURNO_REPOSITORY, type TurnoRepository } from '../turnos/application/ports/out/turno.repository';
import { TurnosModule } from '../turnos/turnos.module';
import { ADMINISTRAR_USUARIOS } from './application/ports/in/administrar-usuarios.use-case';
import { CERRAR_AGENCIA, type CerrarAgenciaUseCase } from './application/ports/in/cerrar-agencia.use-case';
import { GESTIONAR_AGENCIAS } from './application/ports/in/gestionar-agencias.use-case';
import { AGENCIAS_ADMIN, type AgenciasAdminRepository } from './application/ports/out/agencias-admin.repository';
import { AdministrarUsuariosService } from './application/use-cases/administrar-usuarios.service';
import { CerrarAgenciaService } from './application/use-cases/cerrar-agencia.service';
import { GestionarAgenciasService } from './application/use-cases/gestionar-agencias.service';
import { AgenciasAdminController } from './infrastructure/in/http/agencias-admin.controller';
import { UsuariosAdminController } from './infrastructure/in/http/usuarios-admin.controller';
import { CierreProgramador } from './infrastructure/in/programador/cierre.programador';
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
    CierreProgramador,
    {
      provide: CERRAR_AGENCIA,
      useFactory: (
        agencias: AgenciasAdminRepository,
        turnos: TurnoRepository,
        motor: MotorFilasPort,
        catalogo: CatalogoPort,
        eventos: EventStorePort,
        notificador: NotificadorPort,
        ids: GeneradorIdsPort,
        reloj: RelojPort,
        cerrojo: CerrojoPort,
        auditoria: AuditLogPort,
        jornadas: JornadasPort,
      ) => new CerrarAgenciaService(agencias, turnos, motor, catalogo, eventos, notificador, ids, reloj, cerrojo, auditoria, jornadas),
      inject: [AGENCIAS_ADMIN, TURNO_REPOSITORY, MOTOR_FILAS, CATALOGO, EVENT_STORE, NOTIFICADOR, GENERADOR_IDS, RELOJ, CERROJO, AUDIT_LOG, JORNADAS],
    },
    {
      provide: ADMINISTRAR_USUARIOS,
      useFactory: (usuarios: UsuarioRepository, sesiones: SesionesPort, cuentas: CuentasUseCase, auditoria: AuditLogPort) =>
        new AdministrarUsuariosService(usuarios, sesiones, cuentas, auditoria),
      inject: [USUARIO_REPOSITORY, SESIONES, CUENTAS, AUDIT_LOG],
    },
    {
      provide: GESTIONAR_AGENCIAS,
      useFactory: (agencias: AgenciasAdminRepository, invalidador: InvalidadorCatalogoPort, auditoria: AuditLogPort, cierre: CerrarAgenciaUseCase) =>
        new GestionarAgenciasService(agencias, invalidador, auditoria, cierre),
      inject: [AGENCIAS_ADMIN, INVALIDADOR_CATALOGO, AUDIT_LOG, CERRAR_AGENCIA],
    },
  ],
})
export class AdministracionModule {}
