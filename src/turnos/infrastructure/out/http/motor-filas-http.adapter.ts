import { Injectable } from '@nestjs/common';
import { leerConfig } from '../../../../compartido/infrastructure/config';
import type {
  CierreMotor,
  MotorFilasPort,
  ResultadoEncolar,
  TurnoEntregado,
} from '../../../application/ports/out/motor-filas.port';
import type { TipoAtencion } from '../../../domain/tipos';
import { llamarServicio } from '../../../../compartido/infrastructure/http/cliente-servicio';

/** Adaptador de salida hacia el motor de filas (Spring Boot), contrato en /v3/api-docs. */
@Injectable()
export class MotorFilasHttpAdapter implements MotorFilasPort {
  private llamar<T>(metodo: string, ruta: string, cuerpo: unknown, reintentable: boolean) {
    const { motorFilasUrl, serviceToken } = leerConfig();
    return llamarServicio<T>(motorFilasUrl, serviceToken, metodo, ruta, { cuerpo, reintentable });
  }

  async encolar(filaId: string, turnoId: string, tipo: TipoAtencion, k: number): Promise<ResultadoEncolar> {
    const { datos } = await this.llamar<ResultadoEncolar>(
      'POST',
      `/api/v1/filas/${filaId}/turnos`,
      { turnoId, tipoAtencion: tipo, maxPreferencialesSeguidos: k },
      true,
    );
    if (!datos) throw new Error('El motor de filas no devolvió el número del turno');
    return datos;
  }

  async siguiente(filaId: string, k: number): Promise<TurnoEntregado | null> {
    // No se reintenta: un segundo intento entregaría otro turno.
    const { datos } = await this.llamar<TurnoEntregado>(
      'POST',
      `/api/v1/filas/${filaId}/siguiente`,
      { maxPreferencialesSeguidos: k },
      false,
    );
    return datos;
  }

  async personasDelante(filaId: string, turnoId: string, k: number): Promise<number | null> {
    const { datos } = await this.llamar<{ personasDelante: number }>(
      'GET',
      `/api/v1/filas/${filaId}/turnos/${turnoId}/posicion?k=${k}`,
      undefined,
      true,
    );
    return datos?.personasDelante ?? null;
  }

  async retirar(filaId: string, turnoId: string): Promise<void> {
    await this.llamar('DELETE', `/api/v1/filas/${filaId}/turnos/${turnoId}`, undefined, true);
  }

  async cerrarAgencia(agenciaId: string, servicioIds: string[]): Promise<CierreMotor> {
    const { datos } = await this.llamar<{ retiradosPorServicio: Record<string, string[]>; duracionMs: number }>(
      'POST',
      `/api/v1/agencias/${agenciaId}/cierre`,
      { servicioIds },
      true, // vaciar una fila ya vacía no cambia nada
    );
    return {
      retirados: Object.values(datos?.retiradosPorServicio ?? {}).flat(),
      duracionMs: datos?.duracionMs ?? 0,
    };
  }
}
