/** Estadísticas de las mediciones de la sección 10 (latencias en milisegundos). */

function ordenadas(valores: number[]): number[] {
  if (valores.length === 0) throw new Error('No hay valores que resumir');
  return [...valores].sort((a, b) => a - b);
}

/** Percentil por rango más cercano: el valor que deja al menos p % de las muestras a su izquierda. */
export function percentil(valores: number[], p: number): number {
  const v = ordenadas(valores);
  return v[Math.min(v.length - 1, Math.max(0, Math.ceil((p / 100) * v.length) - 1))];
}

export function mediana(valores: number[]): number {
  const v = ordenadas(valores);
  const medio = Math.floor(v.length / 2);
  return v.length % 2 === 0 ? (v[medio - 1] + v[medio]) / 2 : v[medio];
}

export interface Resumen {
  n: number;
  medianaMs: number;
  p95Ms: number;
  minimoMs: number;
  maximoMs: number;
}

export function resumir(valores: number[]): Resumen {
  const v = ordenadas(valores);
  const dos = (x: number) => Math.round(x * 100) / 100;
  return { n: v.length, medianaMs: dos(mediana(v)), p95Ms: dos(percentil(v, 95)), minimoMs: dos(v[0]), maximoMs: dos(v[v.length - 1]) };
}
