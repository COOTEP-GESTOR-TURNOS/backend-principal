import type { Principal } from '../../../compartido/domain/principal';
import type { ConsultarVentanillaUseCase } from '../ports/in/consultar-ventanilla.use-case';
import type { TurnoRepository } from '../ports/out/turno.repository';
import { resumir, ResumenTurno } from '../resumen-turno';
import { turnoEnVentanilla } from '../turno-en-ventanilla';

/** CU-04: al recargar o cambiar de equipo, el funcionario recupera el turno que estaba atendiendo. */
export class ConsultarVentanillaService implements ConsultarVentanillaUseCase {
  constructor(private readonly turnos: TurnoRepository) {}

  async ejecutar(funcionario: Principal): Promise<ResumenTurno | null> {
    const turno = await turnoEnVentanilla(this.turnos, funcionario);
    return turno ? resumir(turno, null) : null;
  }
}
