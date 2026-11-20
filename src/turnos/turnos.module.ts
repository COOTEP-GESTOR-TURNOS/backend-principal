import { Module } from '@nestjs/common';
import { ATENDER_TURNO, CONFIRMAR_PRESENCIA } from './application/ports/in/atender-turno.use-case';
import { CANCELAR_TURNO } from './application/ports/in/cancelar-turno.use-case';
import { CONSULTAR_CATALOGO } from './application/ports/in/consultar-catalogo.use-case';
import { CONSULTAR_FILA } from './application/ports/in/consultar-fila.use-case';
import { REVISAR_VENCIMIENTOS } from './application/ports/in/revisar-vencimientos.use-case';
import { CONSULTAR_MI_TURNO } from './application/ports/in/consultar-mi-turno.use-case';
import { LLAMAR_SIGUIENTE } from './application/ports/in/llamar-siguiente.use-case';
import { SOLICITAR_TURNO } from './application/ports/in/solicitar-turno.use-case';
import { ESTIMADOR, EstimadorPort } from './application/ports/out/estimador.port';
import { MOTOR_FILAS, MotorFilasPort } from './application/ports/out/motor-filas.port';
import {
  CATALOGO,
  CatalogoPort,
  CERROJO,
  CerrojoPort,
  EVENT_STORE,
  EventStorePort,
  GENERADOR_IDS,
  GeneradorIdsPort,
  INVALIDADOR_CATALOGO,
  JORNADAS,
  JornadasPort,
  NOTIFICADOR,
  NotificadorPort,
  PERFIL_ASOCIADO,
  PerfilAsociadoPort,
  RELOJ,
  RelojPort,
} from './application/ports/out/otros.ports';
import { TURNO_REPOSITORY, TurnoRepository } from './application/ports/out/turno.repository';
import { AtenderTurnoService, ConfirmarPresenciaService } from './application/use-cases/atender-turno.service';
import { CancelarTurnoService } from './application/use-cases/cancelar-turno.service';
import { ConsultarCatalogoService } from './application/use-cases/consultar-catalogo.service';
import { ConsultarFilaService } from './application/use-cases/consultar-fila.service';
import { RevisarVencimientosService } from './application/use-cases/revisar-vencimientos.service';
import { ConsultarMiTurnoService } from './application/use-cases/consultar-mi-turno.service';
import { LlamarSiguienteService } from './application/use-cases/llamar-siguiente.service';
import { SolicitarTurnoService } from './application/use-cases/solicitar-turno.service';
import { CatalogoController } from './infrastructure/in/http/catalogo.controller';
import { FilasController } from './infrastructure/in/http/filas.controller';
import { TurnosController } from './infrastructure/in/http/turnos.controller';
import { VencimientosProgramador } from './infrastructure/in/programador/vencimientos.programador';
import { FilasGateway } from './infrastructure/in/ws/filas.gateway';
import { EstimadorHttpAdapter } from './infrastructure/out/http/estimador-http.adapter';
import { MotorFilasHttpAdapter } from './infrastructure/out/http/motor-filas-http.adapter';
import { EventosMongoAdapter } from './infrastructure/out/mongo/eventos-mongo.adapter';
import { CatalogoPgAdapter } from './infrastructure/out/postgres/catalogo-pg.adapter';
import { PerfilAsociadoPgAdapter } from './infrastructure/out/postgres/perfil-asociado-pg.adapter';
import { TurnoPgRepository } from './infrastructure/out/postgres/turno-pg.repository';
import { GeneradorUuid, RelojSistema } from './infrastructure/out/sistema/sistema.adapters';
import { CerrojoRedisAdapter } from './infrastructure/out/redis/cerrojo-redis.adapter';
import { JornadasRedisAdapter } from './infrastructure/out/redis/jornadas-redis.adapter';
import { InvalidadorCatalogoRedisAdapter } from './infrastructure/out/redis/invalidador-catalogo-redis.adapter';
import { NotificadorSocketAdapter } from './infrastructure/out/socketio/notificador-socket.adapter';

/**
 * Cableado del hexágono: cada puerto de salida se enlaza con su adaptador y cada caso de uso
 * se crea con useFactory, así las clases de application/ no llevan decoradores de NestJS.
 * Para cambiar de tecnología basta con cambiar useClass aquí.
 */
@Module({
  controllers: [TurnosController, FilasController, CatalogoController],
  providers: [
    FilasGateway,
    VencimientosProgramador,
    { provide: TURNO_REPOSITORY, useClass: TurnoPgRepository },
    { provide: CATALOGO, useClass: CatalogoPgAdapter },
    { provide: PERFIL_ASOCIADO, useClass: PerfilAsociadoPgAdapter },
    { provide: MOTOR_FILAS, useClass: MotorFilasHttpAdapter },
    { provide: ESTIMADOR, useClass: EstimadorHttpAdapter },
    { provide: EVENT_STORE, useClass: EventosMongoAdapter },
    { provide: NOTIFICADOR, useClass: NotificadorSocketAdapter },
    { provide: RELOJ, useClass: RelojSistema },
    { provide: GENERADOR_IDS, useClass: GeneradorUuid },
    { provide: INVALIDADOR_CATALOGO, useClass: InvalidadorCatalogoRedisAdapter },
    { provide: CERROJO, useClass: CerrojoRedisAdapter },
    { provide: JORNADAS, useClass: JornadasRedisAdapter },
    {
      provide: REVISAR_VENCIMIENTOS,
      useFactory: (
        turnos: TurnoRepository,
        catalogo: CatalogoPort,
        motor: MotorFilasPort,
        eventos: EventStorePort,
        notificador: NotificadorPort,
        ids: GeneradorIdsPort,
        reloj: RelojPort,
        cerrojo: CerrojoPort,
      ) => new RevisarVencimientosService(turnos, catalogo, motor, eventos, notificador, ids, reloj, cerrojo),
      inject: [TURNO_REPOSITORY, CATALOGO, MOTOR_FILAS, EVENT_STORE, NOTIFICADOR, GENERADOR_IDS, RELOJ, CERROJO],
    },
    {
      provide: CONSULTAR_CATALOGO,
      useFactory: (catalogo: CatalogoPort) => new ConsultarCatalogoService(catalogo),
      inject: [CATALOGO],
    },
    {
      provide: CONSULTAR_FILA,
      useFactory: (catalogo: CatalogoPort, motor: MotorFilasPort) => new ConsultarFilaService(catalogo, motor),
      inject: [CATALOGO, MOTOR_FILAS],
    },
    {
      provide: SOLICITAR_TURNO,
      useFactory: (
        turnos: TurnoRepository,
        catalogo: CatalogoPort,
        perfiles: PerfilAsociadoPort,
        motor: MotorFilasPort,
        eventos: EventStorePort,
        notificador: NotificadorPort,
        ids: GeneradorIdsPort,
        reloj: RelojPort,
        jornadas: JornadasPort,
      ) => new SolicitarTurnoService(turnos, catalogo, perfiles, motor, eventos, notificador, ids, reloj, jornadas),
      inject: [TURNO_REPOSITORY, CATALOGO, PERFIL_ASOCIADO, MOTOR_FILAS, EVENT_STORE, NOTIFICADOR, GENERADOR_IDS, RELOJ, JORNADAS],
    },
    {
      provide: CANCELAR_TURNO,
      useFactory: (
        turnos: TurnoRepository,
        motor: MotorFilasPort,
        eventos: EventStorePort,
        notificador: NotificadorPort,
        ids: GeneradorIdsPort,
        reloj: RelojPort,
      ) => new CancelarTurnoService(turnos, motor, eventos, notificador, ids, reloj),
      inject: [TURNO_REPOSITORY, MOTOR_FILAS, EVENT_STORE, NOTIFICADOR, GENERADOR_IDS, RELOJ],
    },
    {
      provide: LLAMAR_SIGUIENTE,
      useFactory: (
        turnos: TurnoRepository,
        catalogo: CatalogoPort,
        motor: MotorFilasPort,
        eventos: EventStorePort,
        notificador: NotificadorPort,
        ids: GeneradorIdsPort,
        reloj: RelojPort,
      ) => new LlamarSiguienteService(turnos, catalogo, motor, eventos, notificador, ids, reloj),
      inject: [TURNO_REPOSITORY, CATALOGO, MOTOR_FILAS, EVENT_STORE, NOTIFICADOR, GENERADOR_IDS, RELOJ],
    },
    {
      provide: CONSULTAR_MI_TURNO,
      useFactory: (
        turnos: TurnoRepository,
        catalogo: CatalogoPort,
        motor: MotorFilasPort,
        estimador: EstimadorPort,
        reloj: RelojPort,
      ) => new ConsultarMiTurnoService(turnos, catalogo, motor, estimador, reloj),
      inject: [TURNO_REPOSITORY, CATALOGO, MOTOR_FILAS, ESTIMADOR, RELOJ],
    },
    {
      provide: ATENDER_TURNO,
      useFactory: (
        turnos: TurnoRepository,
        motor: MotorFilasPort,
        eventos: EventStorePort,
        notificador: NotificadorPort,
        ids: GeneradorIdsPort,
        reloj: RelojPort,
      ) => new AtenderTurnoService(turnos, motor, eventos, notificador, ids, reloj),
      inject: [TURNO_REPOSITORY, MOTOR_FILAS, EVENT_STORE, NOTIFICADOR, GENERADOR_IDS, RELOJ],
    },
    {
      provide: CONFIRMAR_PRESENCIA,
      useFactory: (
        turnos: TurnoRepository,
        eventos: EventStorePort,
        notificador: NotificadorPort,
        ids: GeneradorIdsPort,
        reloj: RelojPort,
      ) => new ConfirmarPresenciaService(turnos, eventos, notificador, ids, reloj),
      inject: [TURNO_REPOSITORY, EVENT_STORE, NOTIFICADOR, GENERADOR_IDS, RELOJ],
    },
  ],
  // La analítica reutiliza el catálogo (con su caché) y el reloj para validar filas y horarios.
  // La administración usa estos puertos para el cierre de agencia (RN-13).
  exports: [CATALOGO, RELOJ, INVALIDADOR_CATALOGO, TURNO_REPOSITORY, MOTOR_FILAS, EVENT_STORE, NOTIFICADOR, GENERADOR_IDS, CERROJO, JORNADAS],
})
export class TurnosModule {}
