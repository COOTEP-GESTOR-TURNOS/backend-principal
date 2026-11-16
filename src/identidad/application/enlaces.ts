import { createHash, randomBytes } from 'node:crypto';
import type { PropositoEnlace } from './limites';
import type { AlmacenTemporalPort } from './ports/out/sesiones.port';

const hash = (token: string) => createHash('sha256').update(token).digest('base64url');

/**
 * Enlaces de un solo uso enviados por correo. Solo se guarda el hash del token (RF-04), y al emitir
 * uno nuevo se anula el anterior del mismo propósito: solo sirve el último correo recibido.
 */
export class EnlacesUnSoloUso {
  constructor(private readonly almacen: AlmacenTemporalPort) {}

  async emitir(usuarioId: string, proposito: PropositoEnlace, ttlSegundos: number): Promise<string> {
    const claveUltimo = `enlace:ultimo:${proposito}:${usuarioId}`;
    const anterior = await this.almacen.obtener<string>(claveUltimo);
    if (anterior) await this.almacen.eliminar(`enlace:${proposito}:${anterior}`);

    const token = randomBytes(32).toString('base64url');
    const h = hash(token);
    await this.almacen.guardar(`enlace:${proposito}:${h}`, { usuarioId }, ttlSegundos);
    await this.almacen.guardar(claveUltimo, h, ttlSegundos);
    return token;
  }

  /** Lee el enlace sin gastarlo (para validar la contraseña nueva antes de consumirlo). */
  async ver(token: string, proposito: PropositoEnlace): Promise<string | null> {
    const datos = await this.almacen.obtener<{ usuarioId: string }>(`enlace:${proposito}:${hash(token)}`);
    return datos?.usuarioId ?? null;
  }

  async consumir(token: string, proposito: PropositoEnlace): Promise<string | null> {
    const datos = await this.almacen.consumir<{ usuarioId: string }>(`enlace:${proposito}:${hash(token)}`);
    if (!datos) return null;
    await this.almacen.eliminar(`enlace:ultimo:${proposito}:${datos.usuarioId}`);
    return datos.usuarioId;
  }
}
