import { ReglaNegocioError } from '../../compartido/domain/errores';

export type ClaveParametro =
  | 'EDAD_ADULTO_MAYOR'
  | 'MAX_PREFERENCIALES_SEGUIDOS'
  | 'N_PROXIMO'
  | 'T_CONFIRMACION_MIN'
  | 'T_LLAMADO_MIN'
  | 'HORARIO_APERTURA'
  | 'HORARIO_CIERRE';

export interface DefinicionParametro {
  clave: ClaveParametro;
  nombre: string;
  descripcion: string;
  /** GLOBAL: solo el superadministrador lo cambia. AGENCIA: cada agencia puede sobrescribirlo. */
  ambito: 'GLOBAL' | 'AGENCIA';
  tipo: 'entero' | 'hora';
  /** Valor que usan las reglas si nadie lo configuró (el mismo de 02-datos-prueba.sql). */
  porDefecto: string;
  min?: number;
  max?: number;
  unidad?: string;
}

/** Parámetros del informe (sección 5, tabla Parámetros) con sus límites razonables. */
export const PARAMETROS: readonly DefinicionParametro[] = [
  { clave: 'HORARIO_APERTURA', nombre: 'Apertura', descripcion: 'Desde esta hora se aceptan turnos (RN-03)', ambito: 'AGENCIA', tipo: 'hora', porDefecto: '08:00' },
  { clave: 'HORARIO_CIERRE', nombre: 'Cierre', descripcion: 'Desde esta hora no se aceptan turnos (RN-03)', ambito: 'AGENCIA', tipo: 'hora', porDefecto: '16:00' },
  { clave: 'MAX_PREFERENCIALES_SEGUIDOS', nombre: 'Preferenciales seguidos (K)', descripcion: 'Turnos preferenciales antes de atender uno general (RN-08)', ambito: 'AGENCIA', tipo: 'entero', porDefecto: '2', min: 1, max: 10 },
  { clave: 'N_PROXIMO', nombre: 'Aviso de próximo', descripcion: 'Con estas personas o menos delante, el turno pasa a Próximo', ambito: 'AGENCIA', tipo: 'entero', porDefecto: '3', min: 1, max: 20, unidad: 'personas' },
  { clave: 'T_CONFIRMACION_MIN', nombre: 'Tiempo para confirmar', descripcion: 'Minutos para confirmar que viene; si no, queda ausente (RN-10)', ambito: 'AGENCIA', tipo: 'entero', porDefecto: '5', min: 1, max: 60, unidad: 'min' },
  { clave: 'T_LLAMADO_MIN', nombre: 'Tiempo para presentarse', descripcion: 'Minutos para llegar a la ventanilla después del llamado (RN-11)', ambito: 'AGENCIA', tipo: 'entero', porDefecto: '3', min: 1, max: 30, unidad: 'min' },
  { clave: 'EDAD_ADULTO_MAYOR', nombre: 'Edad de adulto mayor', descripcion: 'Desde esta edad la atención es preferencial sin pedirla (RN-05)', ambito: 'GLOBAL', tipo: 'entero', porDefecto: '60', min: 50, max: 90, unidad: 'años' },
];

export const VENTANILLAS_MAX = 20;

export function definicion(clave: string): DefinicionParametro {
  const d = PARAMETROS.find((p) => p.clave === clave);
  if (!d) throw new ReglaNegocioError('PARAMETRO_DESCONOCIDO', `No existe el parámetro ${clave}`);
  return d;
}

/**
 * Reglas de los parámetros. Las horas van en punto o y media: la analítica y la recomendación
 * trabajan por franjas de 30 minutos, y un horario 08:15 dejaría franjas a medias.
 */
export class PoliticaParametros {
  static validarValor(clave: string, valor: string): string {
    const d = definicion(clave);
    const limpio = valor.trim();
    if (d.tipo === 'hora') {
      if (!/^([01]\d|2[0-3]):(00|30)$/.test(limpio)) {
        throw new ReglaNegocioError('PARAMETRO_INVALIDO', `${d.nombre}: usa una hora en punto o y media, por ejemplo 08:00 o 13:30`);
      }
      return limpio;
    }
    const numero = Number(limpio);
    if (!Number.isInteger(numero) || numero < d.min! || numero > d.max!) {
      throw new ReglaNegocioError('PARAMETRO_INVALIDO', `${d.nombre}: debe ser un número entero entre ${d.min} y ${d.max}`);
    }
    return String(numero);
  }

  /** EDAD_ADULTO_MAYOR solo existe como valor global. */
  static validarAmbito(clave: string, agenciaId: string | null): void {
    if (agenciaId && definicion(clave).ambito === 'GLOBAL') {
      throw new ReglaNegocioError('PARAMETRO_GLOBAL', `${definicion(clave).nombre} es igual para todas las agencias`);
    }
  }

  static validarHorario(apertura: string, cierre: string): void {
    if (apertura >= cierre) {
      throw new ReglaNegocioError('HORARIO_INVALIDO', `La apertura (${apertura}) debe ser antes del cierre (${cierre})`);
    }
  }

  static validarVentanillas(ventanillas: number): void {
    if (!Number.isInteger(ventanillas) || ventanillas < 1 || ventanillas > VENTANILLAS_MAX) {
      throw new ReglaNegocioError('VENTANILLAS_INVALIDAS', `Las ventanillas van de 1 a ${VENTANILLAS_MAX}`);
    }
  }
}
