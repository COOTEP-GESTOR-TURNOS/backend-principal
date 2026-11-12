/**
 * Política de contraseñas locales (NIST SP 800-63B-4, sección 9 del informe):
 * longitud mínima según el MFA, frases largas permitidas, sin reglas de composición
 * y rechazo de contraseñas comunes o comprometidas.
 */
export const MINIMO_SIN_MFA = 15;
export const MINIMO_CON_MFA = 8;
export const MAXIMO = 128;

/**
 * Muestra mínima. Para la entrega, cargue una lista amplia de contraseñas filtradas
 * (por ejemplo, las más comunes de una lista pública) desde un archivo.
 */
export const CONTRASENAS_COMUNES: ReadonlySet<string> = new Set([
  '123456789012345',
  '1234567890123456',
  'contraseña12345',
  'contrasena12345',
  'password1234567',
  'qwertyuiopasdfg',
  'cootepturno2026',
  'iloveyou1234567',
  'administrador123',
  '12345678',
  'password',
  'qwerty123',
]);

export interface OpcionesPolitica {
  tieneMfa: boolean;
}

export class PoliticaContrasena {
  /** Devuelve la lista de problemas; vacía si la contraseña es aceptable. */
  static validar(
    clave: string,
    { tieneMfa }: OpcionesPolitica,
    comunes: ReadonlySet<string> = CONTRASENAS_COMUNES,
  ): string[] {
    const errores: string[] = [];
    const minimo = tieneMfa ? MINIMO_CON_MFA : MINIMO_SIN_MFA;
    const longitud = [...clave].length; // cuenta caracteres, no bytes
    if (longitud < minimo) errores.push(`Debe tener al menos ${minimo} caracteres`);
    if (longitud > MAXIMO) errores.push(`No puede tener más de ${MAXIMO} caracteres`);
    if (comunes.has(clave.toLowerCase())) errores.push('Es una contraseña común; elija otra');
    if (longitud > 0 && /^(.)\1*$/u.test(clave)) errores.push('No puede ser un solo carácter repetido');
    return errores;
  }
}
