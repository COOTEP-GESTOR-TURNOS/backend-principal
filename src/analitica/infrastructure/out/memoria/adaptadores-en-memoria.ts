import { ServicioNoDisponibleError } from '../../../../compartido/application/errores-aplicacion';
import type { CachePort } from '../../../../compartido/application/ports/cache.port';
import type { AnaliticaPort, RecomendacionAnalitica } from '../../../application/ports/out/analitica.port';

/** Analítica falsa para las pruebas: responde lo indicado y cuenta las llamadas. */
export class AnaliticaEnMemoria implements AnaliticaPort {
  llamadas = 0;
  caida = false;
  constructor(public respuesta: RecomendacionAnalitica | null) {}

  async recomendaciones(): Promise<RecomendacionAnalitica | null> {
    this.llamadas += 1;
    if (this.caida) throw new ServicioNoDisponibleError('analítica caída');
    return this.respuesta;
  }
}

/** Caché en memoria sin vencimiento: basta para probar el cache-aside. */
export class CacheEnMemoria implements CachePort {
  readonly datos = new Map<string, string>();

  async obtener<T>(clave: string): Promise<T | null> {
    const v = this.datos.get(clave);
    return v === undefined ? null : (JSON.parse(v) as T);
  }

  async guardar<T>(clave: string, valor: T): Promise<void> {
    this.datos.set(clave, JSON.stringify(valor));
  }

  async invalidar(clave: string): Promise<void> {
    this.datos.delete(clave);
  }
}
