import { EstadoTurno } from './estado-turno';
import type { Fila } from './fila';
import type { DatosTurno } from './turno';

/** Motivos con los que un turno termina sin que nadie lo marque. */
export type MotivoVencimiento = 'SIN_CONFIRMAR' | 'NO_SE_PRESENTO' | 'CIERRE_AUTOMATICO';

/**
 * RN-10 y RN-11. Un turno Próximo que no confirmó dentro de T_CONFIRMACION, o un turno Llamado
 * que no pasó a atención dentro de T_LLAMADO, vence. Confirmar a tiempo detiene el primer plazo.
 * RN-13: una atención que nadie finalizó vence un margen después del cierre.
 */
export function motivoDeVencimiento(t: Readonly<DatosTurno>, fila: Fila, ahora: Date): MotivoVencimiento | null {
  if (t.estado === EstadoTurno.PROXIMO && !t.confirmadoEn && t.proximoEn && ahora >= fila.limiteConfirmacion(t.proximoEn)) {
    return 'SIN_CONFIRMAR';
  }
  if (t.estado === EstadoTurno.LLAMADO && t.llamadoEn && ahora >= fila.limitePresentacion(t.llamadoEn)) {
    return 'NO_SE_PRESENTO';
  }
  if (t.estado === EstadoTurno.EN_ATENCION && t.inicioAtencionEn && ahora >= fila.limiteAtencion(t.fecha, t.inicioAtencionEn)) {
    return 'CIERRE_AUTOMATICO';
  }
  return null;
}
