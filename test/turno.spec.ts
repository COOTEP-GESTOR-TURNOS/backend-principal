import { ReglaNegocioError, TransicionInvalidaError } from '../src/compartido/domain/errores';
import { EstadoTurno } from '../src/turnos/domain/estado-turno';
import type { TipoAtencion } from '../src/turnos/domain/tipos';
import { Turno } from '../src/turnos/domain/turno';

const ahora = new Date('2026-11-20T14:00:00Z');

function turnoEnEspera(tipo: TipoAtencion = 'GENERAL'): Turno {
  const turno = Turno.solicitar({
    id: 't1',
    agenciaId: 'a1',
    servicioId: 's1',
    asociadoId: 'u1',
    tipoAtencion: tipo,
    canal: 'MOVIL',
    ahora,
  });
  turno.asignarNumero(14, 'C-014');
  turno.ponerEnEspera(ahora);
  return turno;
}

describe('Turno: máquina de estados (RN-04)', () => {
  it('PR-01: recorre el ciclo completo y registra un evento por transición', () => {
    const turno = turnoEnEspera();
    turno.marcarProximo(ahora);
    turno.llamar('f1', ahora);
    turno.iniciarAtencion('f1', ahora);
    turno.finalizar('f1', ahora);

    expect(turno.estado).toBe(EstadoTurno.ATENDIDO);
    expect(turno.extraerEventos().map((e) => e.estadoNuevo)).toEqual([
      EstadoTurno.SOLICITADO,
      EstadoTurno.EN_ESPERA,
      EstadoTurno.PROXIMO,
      EstadoTurno.LLAMADO,
      EstadoTurno.EN_ATENCION,
      EstadoTurno.ATENDIDO,
    ]);
  });

  it('PR-02: rechaza una transición inválida (finalizar un turno en espera)', () => {
    const turno = turnoEnEspera();
    expect(() => turno.finalizar('f1', ahora)).toThrow(TransicionInvalidaError);
    expect(turno.estado).toBe(EstadoTurno.EN_ESPERA);
  });

  it('no permite cancelar un turno que ya fue llamado', () => {
    const turno = turnoEnEspera();
    turno.llamar('f1', ahora);
    expect(() => turno.cancelar('CANCELADO_POR_ASOCIADO', 'u1', ahora)).toThrow(TransicionInvalidaError);
  });

  it('llamar un turno en espera pasa primero por Próximo', () => {
    const turno = turnoEnEspera();
    turno.extraerEventos();
    turno.llamar('f1', ahora);
    expect(turno.extraerEventos().map((e) => e.estadoNuevo)).toEqual([EstadoTurno.PROXIMO, EstadoTurno.LLAMADO]);
  });

  it('cancelar dos veces es idempotente y libera la regla del turno activo', () => {
    const turno = turnoEnEspera();
    expect(turno.cancelar('CANCELADO_POR_ASOCIADO', 'u1', ahora)).toBe(true);
    expect(turno.cancelar('CANCELADO_POR_ASOCIADO', 'u1', ahora)).toBe(false);
    expect(turno.estaActivo()).toBe(false);
  });

  it('un preferencial no verificado vuelve a la fila general (RN-07)', () => {
    const turno = turnoEnEspera('PREFERENCIAL');
    turno.llamar('f1', ahora);
    turno.verificarPreferencial('f1', false, ahora);
    expect(turno.estado).toBe(EstadoTurno.EN_ESPERA);
    expect(turno.tipoAtencion).toBe('GENERAL');
  });

  it('solo confirma presencia un turno próximo o llamado (RN-10)', () => {
    const turno = turnoEnEspera();
    expect(() => turno.confirmarPresencia(ahora)).toThrow(ReglaNegocioError);
    turno.marcarProximo(ahora);
    expect(turno.confirmarPresencia(ahora)).toBe(true);
    expect(turno.confirmarPresencia(ahora)).toBe(false);
  });
});
