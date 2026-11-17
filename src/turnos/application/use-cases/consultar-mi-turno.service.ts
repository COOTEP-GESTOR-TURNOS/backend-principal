import { franjaDe } from '../../../compartido/domain/tiempo';
import { estimarEsperaMin } from '../../domain/estimacion-espera';
import { type Combinar, enParalelo } from '../combinar';
import type { ConsultarMiTurnoUseCase, MiTurno } from '../ports/in/consultar-mi-turno.use-case';
import type { EstimadorPort } from '../ports/out/estimador.port';
import type { MotorFilasPort } from '../ports/out/motor-filas.port';
import type { CatalogoPort, RelojPort } from '../ports/out/otros.ports';
import type { TurnoRepository } from '../ports/out/turno.repository';
import { resumir } from '../resumen-turno';

/**
 * CU-03 Seguir el turno. Concurrencia de E/S (sección 6 del informe): el catálogo sale de la
 * caché y después la posición (motor de filas) y los datos de espera (analítica) se piden a la
 * vez con Promise.allSettled. Cada adaptador corta a los 2 s; si la analítica falla, el turno
 * se muestra igual, sin espera estimada.
 */
export class ConsultarMiTurnoService implements ConsultarMiTurnoUseCase {
  constructor(
    private readonly turnos: TurnoRepository,
    private readonly catalogo: CatalogoPort,
    private readonly motor: MotorFilasPort,
    private readonly estimador: EstimadorPort,
    private readonly reloj: RelojPort,
    /** Producción: en paralelo. La medición de la sección 10 lo cambia por enSecuencia. */
    private readonly combinar: Combinar = enParalelo,
  ) {}

  async ejecutar(asociadoId: string): Promise<MiTurno | null> {
    const turno = await this.turnos.buscarActivoDeAsociado(asociadoId);
    if (!turno) return null;

    const ahora = this.reloj.ahora();
    const fila = await this.catalogo.obtenerFila(turno.agenciaId, turno.servicioId);
    const k = fila?.parametros.maxPreferencialesSeguidos ?? 2;

    const [personas, parametros] = await this.combinar(
      () => this.motor.personasDelante(turno.filaId, turno.id, k),
      () => this.estimador.parametros(turno.agenciaId, turno.servicioId, franjaDe(ahora)),
    );

    const personasDelante = personas.status === 'fulfilled' ? personas.value : null;
    const datosEspera = parametros.status === 'fulfilled' ? parametros.value : null;
    const esperaEstimadaMin =
      personasDelante !== null && datosEspera && fila
        ? estimarEsperaMin({
            personasDelante,
            tAtencionMin: datosEspera.tAtencionMin,
            ventanillas: fila.ventanillas,
            pPreferencial: datosEspera.pPreferencial,
            maxPreferencialesSeguidos: k,
            esPreferencial: turno.tipoAtencion === 'PREFERENCIAL',
          })
        : null;

    return { ...resumir(turno, personasDelante), esperaEstimadaMin };
  }
}
