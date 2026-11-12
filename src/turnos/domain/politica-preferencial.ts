import type { TipoAtencion } from './tipos';

export interface DatosAtencionPreferencial {
  /** Fecha de nacimiento del asociado, si la registró. */
  fechaNacimiento: Date | null;
  /** RN-06: gestante o persona con discapacidad que lo declara al pedir el turno. */
  autodeclarada: boolean;
  hoy: Date;
  /** Parámetro EDAD_ADULTO_MAYOR. */
  edadMinima: number;
}

/**
 * RN-05 y RN-06: decide si el turno va a la fila preferencial.
 * El motivo (gestante o discapacidad) no se guarda: solo el tipo de atención (RN-16).
 */
export class PoliticaPreferencial {
  static tipoAtencion(datos: DatosAtencionPreferencial): TipoAtencion {
    if (datos.autodeclarada) return 'PREFERENCIAL';
    if (datos.fechaNacimiento && edadEnAnios(datos.fechaNacimiento, datos.hoy) >= datos.edadMinima) {
      return 'PREFERENCIAL';
    }
    return 'GENERAL';
  }
}

/** Años cumplidos a una fecha, en UTC. */
export function edadEnAnios(nacimiento: Date, hoy: Date): number {
  const edad = hoy.getUTCFullYear() - nacimiento.getUTCFullYear();
  const aunNoCumple =
    hoy.getUTCMonth() < nacimiento.getUTCMonth() ||
    (hoy.getUTCMonth() === nacimiento.getUTCMonth() && hoy.getUTCDate() < nacimiento.getUTCDate());
  return aunNoCumple ? edad - 1 : edad;
}
