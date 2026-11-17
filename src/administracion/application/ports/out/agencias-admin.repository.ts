export const AGENCIAS_ADMIN = Symbol('AGENCIAS_ADMIN');

export interface ServicioAgencia {
  servicioId: string;
  codigo: string;
  nombre: string;
  prefijo: string;
  ventanillas: number;
  /** false: la agencia dejó de ofrecerlo; no aparece al pedir turno. */
  activo: boolean;
}

export interface ConfiguracionAgencia {
  id: string;
  codigo: string;
  nombre: string;
  municipio: string;
  activa: boolean;
  servicios: ServicioAgencia[];
  /** Solo los valores que la agencia sobrescribe; el resto sale de los globales. */
  parametros: Record<string, string>;
}

/** Puerto de salida de la configuración de agencias (PostgreSQL). */
export interface AgenciasAdminRepository {
  obtener(agenciaId: string): Promise<ConfiguracionAgencia | null>;
  parametrosGlobales(): Promise<Record<string, string>>;
  /** false si la agencia no tiene ese servicio. */
  actualizarServicio(agenciaId: string, servicioId: string, cambios: { ventanillas?: number; activo?: boolean }, actorId: string): Promise<boolean>;
  actualizarAgencia(agenciaId: string, cambios: { activa: boolean }): Promise<void>;
  /** agenciaId null = valor global. */
  fijarParametro(clave: string, agenciaId: string | null, valor: string, actorId: string): Promise<void>;
  /** Borra el valor propio de la agencia: vuelve a usar el global. */
  quitarParametro(clave: string, agenciaId: string): Promise<boolean>;
}
