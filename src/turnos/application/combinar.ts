/**
 * Cómo se esperan dos llamadas de E/S independientes. El servicio usa `enParalelo`; la medición
 * del informe (sección 10) compara contra `enSecuencia` con el mismo caso de uso, sin copiarlo.
 * Las dos devuelven el resultado de cada llamada aunque la otra falle, como Promise.allSettled.
 */
export type Combinar = <A, B>(a: () => Promise<A>, b: () => Promise<B>) => Promise<[PromiseSettledResult<A>, PromiseSettledResult<B>]>;

export const enParalelo: Combinar = (a, b) => Promise.allSettled([a(), b()]);

export const enSecuencia: Combinar = async (a, b) => {
  const [primera] = await Promise.allSettled([a()]);
  const [segunda] = await Promise.allSettled([b()]);
  return [primera, segunda];
};
