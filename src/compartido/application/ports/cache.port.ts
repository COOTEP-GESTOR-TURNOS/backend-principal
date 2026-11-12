export const CACHE = Symbol('CACHE');

/** Caché con TTL (patrón cache-aside). Las claves de sesión NO pasan por aquí. */
export interface CachePort {
  obtener<T>(clave: string): Promise<T | null>;
  guardar<T>(clave: string, valor: T, ttlSegundos: number): Promise<void>;
  invalidar(clave: string): Promise<void>;
}
