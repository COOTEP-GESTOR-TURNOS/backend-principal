import type { InvalidadorCatalogoPort } from '../../../../turnos/application/ports/out/otros.ports';
import type { AgenciasAdminRepository, ConfiguracionAgencia } from '../../../application/ports/out/agencias-admin.repository';

/** Repositorio de agencias en memoria para probar la gestión sin PostgreSQL. */
export class AgenciasEnMemoria implements AgenciasAdminRepository {
  readonly agencias = new Map<string, ConfiguracionAgencia>();
  globales: Record<string, string> = {};

  constructor(iniciales: ConfiguracionAgencia[] = []) {
    for (const a of iniciales) this.agencias.set(a.id, structuredClone(a));
  }

  async obtener(agenciaId: string) {
    const a = this.agencias.get(agenciaId);
    return a ? structuredClone(a) : null;
  }
  async parametrosGlobales() {
    return { ...this.globales };
  }
  async actualizarServicio(agenciaId: string, servicioId: string, cambios: { ventanillas?: number; activo?: boolean }) {
    const s = this.agencias.get(agenciaId)?.servicios.find((x) => x.servicioId === servicioId);
    if (!s) return false;
    if (cambios.ventanillas !== undefined) s.ventanillas = cambios.ventanillas;
    if (cambios.activo !== undefined) s.activo = cambios.activo;
    return true;
  }
  async actualizarAgencia(agenciaId: string, cambios: { activa: boolean }) {
    this.agencias.get(agenciaId)!.activa = cambios.activa;
  }
  async fijarParametro(clave: string, agenciaId: string | null, valor: string) {
    if (agenciaId) this.agencias.get(agenciaId)!.parametros[clave] = valor;
    else this.globales[clave] = valor;
  }
  async quitarParametro(clave: string, agenciaId: string) {
    const p = this.agencias.get(agenciaId)!.parametros;
    const habia = clave in p;
    delete p[clave];
    return habia;
  }
}

/** Registra qué se invalidó, para comprobar que cada cambio borra la caché del catálogo. */
export class InvalidadorEnMemoria implements InvalidadorCatalogoPort {
  readonly invalidadas: string[] = [];
  async invalidarAgencia(agenciaId: string) {
    this.invalidadas.push(agenciaId);
  }
  async invalidarTodo() {
    this.invalidadas.push('*');
  }
}
