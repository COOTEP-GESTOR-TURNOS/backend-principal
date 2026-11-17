import type { AuditLogPort } from '../../../auditoria/application/ports/out/audit-log.port';
import { NoEncontradoError, PermisoDenegadoError } from '../../../compartido/domain/errores';
import type { Principal } from '../../../compartido/domain/principal';
import { PoliticaAdministracion as Politica } from '../../../identidad/domain/politica-administracion';
import { rolPrincipal } from '../../../identidad/domain/usuario';
import type { InvalidadorCatalogoPort } from '../../../turnos/application/ports/out/otros.ports';
import { definicion, PARAMETROS, PoliticaParametros } from '../../domain/parametros';
import type { GestionarAgenciasUseCase, VistaAgencia, VistaParametro } from '../ports/in/gestionar-agencias.use-case';
import type { AgenciasAdminRepository, ConfiguracionAgencia } from '../ports/out/agencias-admin.repository';

/** Une los valores de la agencia, los globales y los de fábrica, en el orden en que los usan las reglas. */
export function vistaParametros(globales: Record<string, string>, propios: Record<string, string> = {}): VistaParametro[] {
  return PARAMETROS.map((d) => {
    const origen = propios[d.clave] !== undefined ? 'AGENCIA' : globales[d.clave] !== undefined ? 'GLOBAL' : 'POR_DEFECTO';
    return {
      clave: d.clave,
      nombre: d.nombre,
      descripcion: d.descripcion,
      tipo: d.tipo,
      min: d.min,
      max: d.max,
      unidad: d.unidad,
      valor: propios[d.clave] ?? globales[d.clave] ?? d.porDefecto,
      origen,
      editableEnAgencia: d.ambito === 'AGENCIA',
    };
  });
}

/**
 * Gestión de agencias (RF-17, CU-05, CU-06). El directivo cambia su agencia; el superadministrador,
 * todas y los parámetros globales. Cada cambio queda en la auditoría con el antes y el después, y
 * borra el catálogo en caché para que la espera estimada use los valores nuevos de inmediato.
 */
export class GestionarAgenciasService implements GestionarAgenciasUseCase {
  constructor(
    private readonly agencias: AgenciasAdminRepository,
    private readonly invalidador: InvalidadorCatalogoPort,
    private readonly auditoria: AuditLogPort,
  ) {}

  async obtener(actor: Principal, agenciaId: string): Promise<VistaAgencia> {
    await this.exigirAmbito(actor, agenciaId, 'CONSULTAR_AGENCIA');
    return this.vista(await this.cargar(agenciaId));
  }

  async actualizarServicio(
    actor: Principal,
    agenciaId: string,
    servicioId: string,
    cambios: { ventanillas?: number; activo?: boolean },
    ip?: string,
  ): Promise<VistaAgencia> {
    await this.exigirAmbito(actor, agenciaId, 'SERVICIO_ACTUALIZADO', ip);
    if (cambios.ventanillas !== undefined) PoliticaParametros.validarVentanillas(cambios.ventanillas);
    const antes = (await this.cargar(agenciaId)).servicios.find((s) => s.servicioId === servicioId);
    if (!antes || !(await this.agencias.actualizarServicio(agenciaId, servicioId, cambios, actor.id))) {
      throw new NoEncontradoError('SERVICIO_NO_ENCONTRADO', 'La agencia no tiene ese servicio');
    }
    await this.invalidador.invalidarAgencia(agenciaId);
    await this.auditar(actor, 'SERVICIO_ACTUALIZADO', agenciaId, `${agenciaId}:${servicioId}`, {
      servicio: antes.codigo,
      antes: { ventanillas: antes.ventanillas, activo: antes.activo },
      despues: cambios,
    }, ip);
    return this.vista(await this.cargar(agenciaId));
  }

  async fijarParametro(actor: Principal, agenciaId: string, clave: string, valor: string, ip?: string): Promise<VistaAgencia> {
    await this.exigirAmbito(actor, agenciaId, 'PARAMETRO_CAMBIADO', ip);
    PoliticaParametros.validarAmbito(clave, agenciaId);
    const limpio = PoliticaParametros.validarValor(clave, valor);
    const actual = await this.vista(await this.cargar(agenciaId));
    this.validarHorarioResultante(actual.parametros, clave, limpio);

    await this.agencias.fijarParametro(clave, agenciaId, limpio, actor.id);
    await this.invalidador.invalidarAgencia(agenciaId);
    const antes = actual.parametros.find((p) => p.clave === clave)!;
    await this.auditar(actor, 'PARAMETRO_CAMBIADO', agenciaId, clave, { antes: antes.valor, origenAntes: antes.origen, despues: limpio }, ip);
    return this.vista(await this.cargar(agenciaId));
  }

  async restablecerParametro(actor: Principal, agenciaId: string, clave: string, ip?: string): Promise<VistaAgencia> {
    await this.exigirAmbito(actor, agenciaId, 'PARAMETRO_RESTABLECIDO', ip);
    definicion(clave);
    const configuracion = await this.cargar(agenciaId);
    const globales = await this.agencias.parametrosGlobales();
    // Al volver al global, el horario resultante también debe ser válido.
    const sinPropio = { ...configuracion.parametros };
    delete sinPropio[clave];
    const resultante = vistaParametros(globales, sinPropio);
    const valorDe = (c: string) => resultante.find((p) => p.clave === c)!.valor;
    PoliticaParametros.validarHorario(valorDe('HORARIO_APERTURA'), valorDe('HORARIO_CIERRE'));

    if (await this.agencias.quitarParametro(clave, agenciaId)) {
      await this.invalidador.invalidarAgencia(agenciaId);
      await this.auditar(actor, 'PARAMETRO_RESTABLECIDO', agenciaId, clave, { antes: configuracion.parametros[clave], despues: valorDe(clave) }, ip);
    }
    return this.vista(await this.cargar(agenciaId), globales);
  }

  async actualizarAgencia(actor: Principal, agenciaId: string, cambios: { activa: boolean }, ip?: string): Promise<VistaAgencia> {
    await this.exigirSuperadmin(actor, 'AGENCIA_ACTUALIZADA', agenciaId, ip);
    const antes = await this.cargar(agenciaId);
    await this.agencias.actualizarAgencia(agenciaId, cambios);
    await this.invalidador.invalidarAgencia(agenciaId);
    if (antes.activa !== cambios.activa) {
      await this.auditar(actor, cambios.activa ? 'AGENCIA_ACTIVADA' : 'AGENCIA_DESACTIVADA', agenciaId, agenciaId, {}, ip);
    }
    return this.vista(await this.cargar(agenciaId));
  }

  async parametrosGlobales(actor: Principal): Promise<VistaParametro[]> {
    await this.exigirSuperadmin(actor, 'CONSULTAR_PARAMETROS_GLOBALES', 'GLOBAL');
    const globales = await this.agencias.parametrosGlobales();
    return vistaParametros({}, globales).map((p) => ({ ...p, origen: p.origen === 'AGENCIA' ? 'GLOBAL' : p.origen }));
  }

  async fijarParametroGlobal(actor: Principal, clave: string, valor: string, ip?: string): Promise<VistaParametro[]> {
    await this.exigirSuperadmin(actor, 'PARAMETRO_CAMBIADO', 'GLOBAL', ip);
    const limpio = PoliticaParametros.validarValor(clave, valor);
    const actuales = await this.parametrosGlobales(actor);
    this.validarHorarioResultante(actuales, clave, limpio);
    await this.agencias.fijarParametro(clave, null, limpio, actor.id);
    // Un global afecta a todas las agencias que no lo sobrescriben.
    await this.invalidador.invalidarTodo();
    const antes = actuales.find((p) => p.clave === clave)!;
    await this.auditar(actor, 'PARAMETRO_CAMBIADO', 'GLOBAL', clave, { antes: antes.valor, despues: limpio }, ip);
    return this.parametrosGlobales(actor);
  }

  private validarHorarioResultante(actuales: VistaParametro[], clave: string, valor: string): void {
    if (clave !== 'HORARIO_APERTURA' && clave !== 'HORARIO_CIERRE') return;
    const otro = (c: string) => actuales.find((p) => p.clave === c)!.valor;
    const apertura = clave === 'HORARIO_APERTURA' ? valor : otro('HORARIO_APERTURA');
    const cierre = clave === 'HORARIO_CIERRE' ? valor : otro('HORARIO_CIERRE');
    PoliticaParametros.validarHorario(apertura, cierre);
  }

  private async cargar(agenciaId: string): Promise<ConfiguracionAgencia> {
    const agencia = await this.agencias.obtener(agenciaId);
    if (!agencia) throw new NoEncontradoError('AGENCIA_NO_ENCONTRADA', 'La agencia no existe');
    return agencia;
  }

  private async vista(c: ConfiguracionAgencia, globales?: Record<string, string>): Promise<VistaAgencia> {
    const g = globales ?? (await this.agencias.parametrosGlobales());
    return {
      id: c.id,
      codigo: c.codigo,
      nombre: c.nombre,
      municipio: c.municipio,
      activa: c.activa,
      servicios: c.servicios,
      parametros: vistaParametros(g, c.parametros),
    };
  }

  /** RN-15: fuera de su agencia, 403 y registro en la auditoría (CU-05). */
  private async exigirAmbito(actor: Principal, agenciaId: string, accion: string, ip?: string): Promise<void> {
    if (Politica.puedeAdministrarAgencia(actor, agenciaId)) return;
    await this.auditar(actor, 'INTENTO_FUERA_DE_AMBITO', agenciaId, agenciaId, { accion }, ip);
    throw new PermisoDenegadoError('FUERA_DE_AMBITO', 'Solo puedes administrar tu agencia');
  }

  private async exigirSuperadmin(actor: Principal, accion: string, objetivo: string, ip?: string): Promise<void> {
    if (Politica.esSuperadmin(actor)) return;
    await this.auditar(actor, 'INTENTO_FUERA_DE_AMBITO', objetivo === 'GLOBAL' ? 'GLOBAL' : objetivo, objetivo, { accion }, ip);
    throw new PermisoDenegadoError('FUERA_DE_AMBITO', 'Solo el superadministrador puede hacer este cambio');
  }

  private auditar(actor: Principal, accion: string, ambito: string, objetivoId: string, detalle: Record<string, unknown>, ip?: string) {
    return this.auditoria.registrar({
      ambito,
      actorId: actor.id,
      actorRol: rolPrincipal(actor.roles),
      accion,
      objetivoTipo: accion.startsWith('PARAMETRO') ? 'PARAMETRO' : accion.startsWith('SERVICIO') ? 'SERVICIO_AGENCIA' : 'AGENCIA',
      objetivoId,
      detalle,
      ip,
    });
  }
}
