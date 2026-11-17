import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { leerConfig } from '../../../../compartido/infrastructure/config';
import { REVISAR_VENCIMIENTOS, type RevisarVencimientosUseCase } from '../../../application/ports/in/revisar-vencimientos.use-case';

/**
 * Adaptador de entrada por tiempo: cada VENCIMIENTOS_INTERVALO_SEG (30 s por defecto) ejecuta un
 * ciclo de vencimientos. No empieza uno nuevo si el anterior sigue en curso; con 0 se apaga.
 */
@Injectable()
export class VencimientosProgramador implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(VencimientosProgramador.name);
  private temporizador?: NodeJS.Timeout;
  private enCurso = false;

  constructor(@Inject(REVISAR_VENCIMIENTOS) private readonly revisar: RevisarVencimientosUseCase) {}

  onApplicationBootstrap(): void {
    const segundos = leerConfig().vencimientosIntervaloSeg;
    if (segundos <= 0) {
      this.logger.warn('Revisión de vencimientos apagada (VENCIMIENTOS_INTERVALO_SEG=0)');
      return;
    }
    this.temporizador = setInterval(() => void this.ciclo(), segundos * 1000);
    this.temporizador.unref();
  }

  onApplicationShutdown(): void {
    clearInterval(this.temporizador);
  }

  private async ciclo(): Promise<void> {
    if (this.enCurso) return;
    this.enCurso = true;
    try {
      const r = await this.revisar.ejecutar();
      if (r.proximos + r.sinConfirmar + r.noSePresento + r.conflictos + r.errores > 0) {
        this.logger.log(
          `Vencimientos: ${r.revisados} revisados, ${r.proximos} próximos, ${r.sinConfirmar} sin confirmar, ` +
            `${r.noSePresento} no se presentaron, ${r.conflictos} en conflicto, ${r.errores} con error`,
        );
      }
    } catch (error) {
      this.logger.warn(`La revisión de vencimientos falló: ${String(error)}`);
    } finally {
      this.enCurso = false;
    }
  }
}
