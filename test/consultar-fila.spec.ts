import { NoEncontradoError, PermisoDenegadoError } from '../src/compartido/domain/errores';
import type { Principal } from '../src/compartido/domain/principal';
import { ConsultarFilaService } from '../src/turnos/application/use-cases/consultar-fila.service';
import { AGENCIA, armarEscenario, OTRA_AGENCIA, SERVICIO } from './armar-escenario';

const funcionario: Principal = { id: 'f1', roles: [{ rol: 'FUNCIONARIO', agenciaId: AGENCIA, servicioId: SERVICIO }] };
const administrador: Principal = { id: 'a1', roles: [{ rol: 'ADMIN_AGENCIA', agenciaId: AGENCIA }] };
const consulta = { agenciaId: AGENCIA, servicioId: SERVICIO, funcionario };

describe('Caso de uso ConsultarFila', () => {
  it('pagina en el orden de entrega y mantiene intacta la fila', async () => {
    const { catalogo, motor, fila } = armarEscenario();
    const consultar = new ConsultarFilaService(catalogo, motor);
    await motor.encolar(fila.id, 'g1', 'GENERAL', 2);
    await motor.encolar(fila.id, 'p1', 'PREFERENCIAL', 2);
    await motor.encolar(fila.id, 'p2', 'PREFERENCIAL', 2);
    await motor.encolar(fila.id, 'g2', 'GENERAL', 2);
    await motor.encolar(fila.id, 'p3', 'PREFERENCIAL', 2);
    await motor.siguiente(fila.id, 2);

    await expect(consultar.ejecutar({ ...consulta, pagina: 1, tamano: 2 })).resolves.toEqual({
      elementos: [
        { turnoId: 'p2', numero: 3, tipoAtencion: 'PREFERENCIAL' },
        { turnoId: 'g1', numero: 1, tipoAtencion: 'GENERAL' },
      ],
      pagina: 1, tamano: 2, total: 4, totalPaginas: 2,
    });
    const pagina = await consultar.ejecutar({ ...consulta, pagina: 2, tamano: 2, funcionario: administrador });
    expect(pagina.elementos.map((turno) => turno.turnoId)).toEqual(['p3', 'g2']);
    await expect(consultar.ejecutar({ ...consulta, pagina: 3, tamano: 2 })).resolves.toEqual({
      elementos: [], pagina: 3, tamano: 2, total: 4, totalPaginas: 2,
    });
    expect((await motor.siguiente(fila.id, 2))?.turnoId).toBe('p2');
  });

  it('distingue una fila vacía, una fuera del ámbito y un servicio inexistente', async () => {
    const { catalogo, motor } = armarEscenario();
    const consultar = new ConsultarFilaService(catalogo, motor);
    await expect(consultar.ejecutar(consulta)).resolves.toEqual({
      elementos: [], pagina: 1, tamano: 20, total: 0, totalPaginas: 0,
    });
    await expect(consultar.ejecutar({ ...consulta, agenciaId: OTRA_AGENCIA })).rejects.toBeInstanceOf(PermisoDenegadoError);
    await expect(consultar.ejecutar({ ...consulta, servicioId: 'otro-servicio' })).rejects.toBeInstanceOf(PermisoDenegadoError);
    await expect(consultar.ejecutar({ ...consulta, servicioId: 'otro-servicio', funcionario: administrador })).rejects.toBeInstanceOf(NoEncontradoError);
  });
});
