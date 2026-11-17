import { horaLocal } from '../../compartido/domain/tiempo';

export interface ParametrosFila {
  /** N_PROXIMO: con estas personas o menos delante, el turno pasa a Próximo. */
  nProximo: number;
  /** K: preferenciales seguidos antes de atender uno general (RN-08). */
  maxPreferencialesSeguidos: number;
  /** EDAD_ADULTO_MAYOR (RN-05). */
  edadAdultoMayor: number;
  /** T_CONFIRMACION_MIN (RN-10): minutos para confirmar desde que el turno queda Próximo. */
  tConfirmacionMin?: number;
  /** T_LLAMADO_MIN (RN-11): minutos para presentarse en la ventanilla después del llamado. */
  tLlamadoMin?: number;
}

/** Valores de fábrica, los mismos de 02-datos-prueba.sql. */
export const T_CONFIRMACION_MIN_POR_DEFECTO = 5;
export const T_LLAMADO_MIN_POR_DEFECTO = 3;
const MINUTO_MS = 60_000;

export interface HorarioAtencion {
  apertura: string; // HH:MM
  cierre: string; // HH:MM
}

/** Fila de una agencia para un servicio: datos de catálogo y parámetros que usan las reglas. */
export class Fila {
  constructor(
    readonly agenciaId: string,
    readonly servicioId: string,
    readonly prefijoTurno: string,
    readonly ventanillas: number,
    readonly horario: HorarioAtencion,
    readonly parametros: ParametrosFila,
    readonly activa: boolean,
  ) {}

  /** Identificador compartido entre motores: agencia_id:servicio_id. */
  get id(): string {
    return `${this.agenciaId}:${this.servicioId}`;
  }

  /** RN-03: solo se aceptan turnos en el horario de atención (hora local de la agencia). */
  estaAbierta(ahora: Date): boolean {
    const hora = horaLocal(ahora);
    return this.activa && hora >= this.horario.apertura && hora < this.horario.cierre;
  }

  /** Código visible del turno, por ejemplo C-014. */
  codigoPara(numero: number): string {
    return `${this.prefijoTurno}-${String(numero).padStart(3, '0')}`;
  }

  /** RN-10: hasta cuándo puede confirmar un turno que quedó Próximo en `proximoEn`. */
  limiteConfirmacion(proximoEn: Date): Date {
    return new Date(proximoEn.getTime() + (this.parametros.tConfirmacionMin ?? T_CONFIRMACION_MIN_POR_DEFECTO) * MINUTO_MS);
  }

  /** RN-11: hasta cuándo puede presentarse un turno llamado en `llamadoEn`. */
  limitePresentacion(llamadoEn: Date): Date {
    return new Date(llamadoEn.getTime() + (this.parametros.tLlamadoMin ?? T_LLAMADO_MIN_POR_DEFECTO) * MINUTO_MS);
  }

  /** RN-10: el turno queda Próximo con N_PROXIMO personas o menos delante. */
  debeMarcarseProximo(personasDelante: number): boolean {
    return personasDelante <= this.parametros.nProximo;
  }
}
