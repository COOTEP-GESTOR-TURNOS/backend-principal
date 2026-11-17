import type { Principal } from '../../../../compartido/domain/principal';
import type { ClaveParametro } from '../../../domain/parametros';
import type { ServicioAgencia } from '../out/agencias-admin.repository';

export const GESTIONAR_AGENCIAS = Symbol('GESTIONAR_AGENCIAS');

export interface VistaParametro {
  clave: ClaveParametro;
  nombre: string;
  descripcion: string;
  tipo: 'entero' | 'hora';
  min?: number;
  max?: number;
  unidad?: string;
  /** Valor que usan las reglas ahora mismo. */
  valor: string;
  /** De dónde sale: valor propio de la agencia, global o el de fábrica. */
  origen: 'AGENCIA' | 'GLOBAL' | 'POR_DEFECTO';
  /** false para los globales (EDAD_ADULTO_MAYOR): solo el superadministrador los cambia. */
  editableEnAgencia: boolean;
}

export interface VistaAgencia {
  id: string;
  codigo: string;
  nombre: string;
  municipio: string;
  activa: boolean;
  /** RN-13: hoy ya no recibe turnos porque se cerró la jornada (a mano o a la hora de cierre). */
  jornadaCerrada: boolean;
  servicios: ServicioAgencia[];
  parametros: VistaParametro[];
}

/** Puerto de entrada (RF-17, CU-05, CU-06): configuración de agencias dentro del ámbito del administrador. */
export interface GestionarAgenciasUseCase {
  obtener(actor: Principal, agenciaId: string): Promise<VistaAgencia>;
  actualizarServicio(actor: Principal, agenciaId: string, servicioId: string, cambios: { ventanillas?: number; activo?: boolean }, ip?: string): Promise<VistaAgencia>;
  fijarParametro(actor: Principal, agenciaId: string, clave: string, valor: string, ip?: string): Promise<VistaAgencia>;
  restablecerParametro(actor: Principal, agenciaId: string, clave: string, ip?: string): Promise<VistaAgencia>;
  /** Solo el superadministrador abre o cierra una agencia completa. */
  actualizarAgencia(actor: Principal, agenciaId: string, cambios: { activa: boolean }, ip?: string): Promise<VistaAgencia>;
  parametrosGlobales(actor: Principal): Promise<VistaParametro[]>;
  fijarParametroGlobal(actor: Principal, clave: string, valor: string, ip?: string): Promise<VistaParametro[]>;
}
