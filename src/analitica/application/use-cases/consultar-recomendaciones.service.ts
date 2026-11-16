import { ServicioNoDisponibleError } from '../../../compartido/application/errores-aplicacion';
import type { CachePort } from '../../../compartido/application/ports/cache.port';
import { NoEncontradoError, ReglaNegocioError } from '../../../compartido/domain/errores';
import { fechaLocal, franjaDe } from '../../../compartido/domain/tiempo';
import type { CatalogoPort, RelojPort } from '../../../turnos/application/ports/out/otros.ports';
import type {
  ConsultarRecomendacionesUseCase,
  FranjaRecomendada,
  RecomendacionHorario,
} from '../ports/in/consultar-recomendaciones.use-case';
import type { AnaliticaPort, RecomendacionAnalitica } from '../ports/out/analitica.port';

/** cache:recomendacion:{agencia}:{servicio}:{fecha}, 15 min (sección 5 del informe). */
export const TTL_RECOMENDACION_SEG = 15 * 60;
/** Se recomienda para hoy y los próximos días; el historial no dice nada útil más lejos. */
export const DIAS_MAXIMOS = 7;

const DIA_MS = 24 * 60 * 60 * 1000;

function sumarMediaHora(franja: string): string {
  const [h, m] = franja.split(':').map(Number);
  const total = h * 60 + m + 30;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * Caso de uso de la recomendación de horario (RF-10, CU-02). La estadística la calcula la
 * analítica; aquí se valida la fila, se guarda en caché y se ajusta a la hora actual y al
 * horario de la agencia, para no recomendar una franja que ya pasó o que está cerrada.
 */
export class ConsultarRecomendacionesService implements ConsultarRecomendacionesUseCase {
  constructor(
    private readonly catalogo: CatalogoPort,
    private readonly analitica: AnaliticaPort,
    private readonly cache: CachePort,
    private readonly reloj: RelojPort,
  ) {}

  async ejecutar(cmd: { agenciaId: string; servicioId: string; fecha?: string }): Promise<RecomendacionHorario> {
    const fila = await this.catalogo.obtenerFila(cmd.agenciaId, cmd.servicioId);
    if (!fila) throw new NoEncontradoError('FILA_NO_ENCONTRADA', 'La agencia no ofrece ese servicio');

    const ahora = this.reloj.ahora();
    const hoy = fechaLocal(ahora);
    const fecha = cmd.fecha ?? hoy;
    const dias = Math.round((Date.parse(fecha) - Date.parse(hoy)) / DIA_MS);
    if (dias < 0 || dias > DIAS_MAXIMOS) {
      throw new ReglaNegocioError('FECHA_FUERA_DE_RANGO', `Se recomienda para hoy y los próximos ${DIAS_MAXIMOS} días`);
    }

    const base = { agenciaId: fila.agenciaId, servicioId: fila.servicioId, fecha, horario: fila.horario };
    let recomendacion: RecomendacionAnalitica | null;
    try {
      recomendacion = await this.leer(fila.agenciaId, fila.servicioId, fecha);
    } catch (error) {
      if (error instanceof ServicioNoDisponibleError) return { ...base, tipoDia: null, disponible: false, franjas: [] };
      throw error;
    }

    // Lo guardado en caché puede tener hasta 15 min: se quitan las franjas que ya pasaron.
    const desde = fecha === hoy ? franjaDe(ahora) : '00:00';
    const franjas: FranjaRecomendada[] = (recomendacion?.franjas ?? [])
      .filter((f) => f.franja >= desde && f.franja >= fila.horario.apertura && f.franja < fila.horario.cierre)
      .map((f) => ({ desde: f.franja, hasta: sumarMediaHora(f.franja), esperaMedianaMin: f.esperaMedianaMin, turnos: f.turnos }));
    return { ...base, tipoDia: recomendacion?.tipoDia ?? null, disponible: true, franjas };
  }

  /** Cache-aside: una caída de Redis solo hace más lenta la consulta (el adaptador la tolera). */
  private async leer(agenciaId: string, servicioId: string, fecha: string): Promise<RecomendacionAnalitica | null> {
    const clave = `recomendacion:${agenciaId}:${servicioId}:${fecha}`;
    const guardada = await this.cache.obtener<RecomendacionAnalitica>(clave);
    if (guardada) return guardada;
    const nueva = await this.analitica.recomendaciones(agenciaId, servicioId, fecha);
    if (nueva) await this.cache.guardar(clave, nueva, TTL_RECOMENDACION_SEG);
    return nueva;
  }
}
