import type { ConsultarCatalogoUseCase } from '../ports/in/consultar-catalogo.use-case';
import type { AgenciaCatalogo, CatalogoPort } from '../ports/out/otros.ports';

export class ConsultarCatalogoService implements ConsultarCatalogoUseCase {
  constructor(private readonly catalogo: CatalogoPort) {}

  listarAgencias(): Promise<AgenciaCatalogo[]> {
    return this.catalogo.listarAgencias();
  }
}
