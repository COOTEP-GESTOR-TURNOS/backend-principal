import type { IndicadoresAgencia, ValoresIndicadores } from '../in/consultar-indicadores.use-case';

export const DEMANDA = Symbol('DEMANDA');

export const TIPOS_EVENTO_AGENCIA = ['FESTIVO_LOCAL', 'PAGO_SUBSIDIO_FAMILIAR', 'PAGO_NOMINA'] as const;
export const NIVELES_DEMANDA = ['BAJA', 'MEDIA', 'ALTA'] as const;
export const ESTADOS_PRONOSTICO = ['DISPONIBLE', 'HISTORIAL_INSUFICIENTE', 'SOLO_CALENDARIO', 'INCOMPLETO'] as const;

export type TipoEventoAgencia = (typeof TIPOS_EVENTO_AGENCIA)[number];

export interface DatosEventoAgencia {
  fecha: string;
  tipo: TipoEventoAgencia;
}

export interface EventoAgencia extends DatosEventoAgencia {
  id: string;
  agenciaId?: string;
  agenciaNombre?: string;
}

export interface DiaDemanda {
  fecha: string;
  diaHabil: boolean;
  finDeSemana: boolean;
  festivoNacional: string | null;
  festivosPutumayo: string[];
  vencimientoCredito: boolean;
  eventos: EventoAgencia[];
  turnosRegistrados: number | null;
  turnosEstimados: number | null;
  nivelDemanda: (typeof NIVELES_DEMANDA)[number] | null;
}

export interface CalendarioDemanda {
  agenciaId: string | null;
  mes: string;
  fuente: 'REAL' | 'SIMULADA';
  estadoPronostico: (typeof ESTADOS_PRONOSTICO)[number];
  dias: DiaDemanda[];
}

export interface UbicacionAgenciaPutumayo {
  departamento: 'PUTUMAYO';
  municipio: string;
}

export type OpcionesCalendarioAgencia = Partial<UbicacionAgenciaPutumayo> & {
  activa?: boolean;
  servicioId?: string;
  servicioActivo?: boolean;
};

export interface AgenciaTableroMensual {
  agenciaId: string;
  nombre: string;
  municipio: string;
  activa: boolean;
  departamento?: 'PUTUMAYO';
  servicioActivo?: boolean;
}

export interface FiltrosIndicadores {
  servicioId?: string;
  colaboradorId?: string;
}

export interface ActividadAnalitica {
  agenciaId: string;
  servicioId: string;
  colaboradorId: string | null;
}

export interface RangoAnalitica {
  desde: string;
  hasta: string;
}

export interface TableroMensual {
  fuente: CalendarioDemanda['fuente'];
  actualizadoEn: string | null;
  desde: string;
  hasta: string;
  resumen: ValoresIndicadores;
  agencias: IndicadoresAgencia[];
  calendario: CalendarioDemanda;
}

export interface DemandaPort {
  calendario(agenciaId: string, mes: string, opciones?: OpcionesCalendarioAgencia): Promise<CalendarioDemanda>;
  tablero(mes: string, agencias: AgenciaTableroMensual[], agenciaId: string | null, filtros?: FiltrosIndicadores): Promise<TableroMensual>;
  opcionesHistoricas(rango: RangoAnalitica, agenciaIds: string[], servicioId?: string): Promise<ActividadAnalitica[]>;
  crearEvento(agenciaId: string, datos: DatosEventoAgencia): Promise<EventoAgencia>;
  editarEvento(agenciaId: string, eventoId: string, cambios: Partial<DatosEventoAgencia>): Promise<EventoAgencia>;
  eliminarEvento(agenciaId: string, eventoId: string): Promise<void>;
}
