import { NoEncontradoError, PermisoDenegadoError } from '../../../compartido/domain/errores';
import { puedeOperarFila } from '../../../compartido/domain/principal';
import type { ConsultarFilaComando, ConsultarFilaUseCase } from '../ports/in/consultar-fila.use-case';
import type { MotorFilasPort } from '../ports/out/motor-filas.port';
import type { CatalogoPort } from '../ports/out/otros.ports';

export class ConsultarFilaService implements ConsultarFilaUseCase {
  constructor(private readonly catalogo: CatalogoPort, private readonly motor: MotorFilasPort) {}

  async ejecutar({ agenciaId, servicioId, funcionario, pagina, tamano }: ConsultarFilaComando) {
    if (!puedeOperarFila(funcionario, agenciaId, servicioId)) {
      throw new PermisoDenegadoError('FILA_FUERA_DE_AMBITO', 'No puedes consultar la fila de otra agencia o servicio');
    }
    const fila = await this.catalogo.obtenerFila(agenciaId, servicioId);
    if (!fila) throw new NoEncontradoError('FILA_NO_EXISTE', 'La agencia no ofrece ese servicio');
    return this.motor.listar(fila.id, fila.parametros.maxPreferencialesSeguidos, { pagina, tamano });
  }
}
