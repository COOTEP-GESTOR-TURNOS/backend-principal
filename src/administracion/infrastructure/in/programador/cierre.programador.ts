import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { leerConfig } from '../../../../compartido/infrastructure/config';
import { CERRAR_AGENCIA, type CerrarAgenciaUseCase } from '../../../application/ports/in/cerrar-agencia.use-case';

/**
 * Adaptador de entrada por tiempo: cada CIERRE_INTERVALO_SEG (60 s por defecto) cierra la jornada
 * de las agencias que ya pasaron su HORARIO_CIERRE. Un cerrojo en Redis por agencia y día evita
 * cerrar dos veces, aunque haya varias instancias del backend. Con 0 se apaga.
 */
@Injectable()
export class CierreProgramador implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(CierreProgramador.name);
  private temporizador?: NodeJS.Timeout;
  private enCurso = false;

  constructor(@Inject(CERRAR_AGENCIA) private readonly cerrar: CerrarAgenciaUseCase) {}

  onApplicationBootstrap(): void {
    const segundos = leerConfig().cierreIntervaloSeg;
    if (segundos <= 0) {
      this.logger.warn('Cierre automático de agencias apagado (CIERRE_INTERVALO_SEG=0)');
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
      for (const r of await this.cerrar.cierreAutomatico()) {
        this.logger.log(
          `Jornada cerrada en ${r.nombre}: ${r.cancelados} turnos cancelados, ${r.retiradosDelMotor} retirados del motor ` +
            `en ${r.duracionMotorMs} ms, ${r.siguenEnAtencion} siguen en atención`,
        );
      }
    } catch (error) {
      this.logger.warn(`El cierre automático falló: ${String(error)}`);
    } finally {
      this.enCurso = false;
    }
  }
}
