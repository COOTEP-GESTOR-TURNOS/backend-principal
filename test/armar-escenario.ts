import { CancelarTurnoService } from '../src/turnos/application/use-cases/cancelar-turno.service';
import { ConsultarMiTurnoService } from '../src/turnos/application/use-cases/consultar-mi-turno.service';
import { LlamarSiguienteService } from '../src/turnos/application/use-cases/llamar-siguiente.service';
import { SolicitarTurnoService } from '../src/turnos/application/use-cases/solicitar-turno.service';
import { Fila } from '../src/turnos/domain/fila';
import {
  CatalogoEnMemoria,
  EstimadorEnMemoria,
  EventStoreEnMemoria,
  GeneradorIdsSecuencial,
  MotorFilasEnMemoria,
  NotificadorEnMemoria,
  PerfilAsociadoEnMemoria,
  RelojFijo,
  TurnoRepositoryEnMemoria,
} from '../src/turnos/infrastructure/out/memoria/adaptadores-en-memoria';

export const AGENCIA = 'a0000000-0000-4000-8000-000000000001';
export const OTRA_AGENCIA = 'a0000000-0000-4000-8000-000000000002';
export const SERVICIO = 'b0000000-0000-4000-8000-000000000001';

/** Escenario completo con adaptadores en memoria: 09:00 en Mocoa, agencia abierta de 08:00 a 16:00. */
export function armarEscenario(instante = new Date('2026-11-20T14:00:00Z')) {
  const turnos = new TurnoRepositoryEnMemoria();
  const fila = new Fila(
    AGENCIA,
    SERVICIO,
    'C',
    2,
    { apertura: '08:00', cierre: '16:00' },
    { nProximo: 3, maxPreferencialesSeguidos: 2, edadAdultoMayor: 60 },
    true,
  );
  const catalogo = new CatalogoEnMemoria([fila]);
  const perfiles = new PerfilAsociadoEnMemoria({ joven: new Date('1990-05-01'), mayor: new Date('1950-03-10') });
  const motor = new MotorFilasEnMemoria();
  const eventos = new EventStoreEnMemoria();
  const notificador = new NotificadorEnMemoria();
  const ids = new GeneradorIdsSecuencial();
  const reloj = new RelojFijo(instante);

  return {
    turnos,
    motor,
    eventos,
    notificador,
    reloj,
    solicitar: new SolicitarTurnoService(turnos, catalogo, perfiles, motor, eventos, notificador, ids, reloj),
    cancelar: new CancelarTurnoService(turnos, motor, eventos, notificador, ids, reloj),
    llamar: new LlamarSiguienteService(turnos, catalogo, motor, eventos, notificador, ids, reloj),
    consultar: new ConsultarMiTurnoService(turnos, catalogo, motor, new EstimadorEnMemoria(), reloj),
  };
}

export function comando(asociadoId: string, idempotencyKey: string, solicitaPreferencial = false) {
  return { asociadoId, agenciaId: AGENCIA, servicioId: SERVICIO, solicitaPreferencial, canal: 'WEB' as const, idempotencyKey };
}
