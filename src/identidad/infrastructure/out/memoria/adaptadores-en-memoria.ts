import { randomUUID } from 'node:crypto';
import type { AuditLogPort, EntradaAuditoria } from '../../../../auditoria/application/ports/out/audit-log.port';
import { ConflictoError } from '../../../../compartido/domain/errores';
import type { AsignacionRol } from '../../../../compartido/domain/principal';
import type { AsignacionGuardada, CuentaUsuario } from '../../../domain/usuario';
import type { PasswordHasherPort, ProveedorOidc } from '../../../application/ports/out/identidad.ports';
import type {
  CifradorPort,
  CorreoPort,
  EmisorTokensPort,
  MensajeCorreo,
  TokenAcceso,
} from '../../../application/ports/out/seguridad.ports';
import type { AlmacenTemporalPort, LimitadorPort, Sesion, SesionesPort } from '../../../application/ports/out/sesiones.port';
import type {
  CambiosUsuario,
  FiltroUsuarios,
  NuevoUsuario,
  PaginaUsuarios,
  UsuarioRepository,
} from '../../../application/ports/out/usuario.repository';

/**
 * Adaptadores en memoria para probar los casos de uso sin PostgreSQL ni Redis (RNF-10).
 * El reloj es controlable: avanzar() simula el paso del tiempo para los vencimientos.
 */
export class RelojControlable {
  constructor(public actual = new Date('2026-11-16T14:00:00Z')) {}
  ahora = () => this.actual;
  avanzar(segundos: number): void {
    this.actual = new Date(this.actual.getTime() + segundos * 1000);
  }
  ms(): number {
    return this.actual.getTime();
  }
}

export class UsuariosEnMemoria implements UsuarioRepository {
  readonly cuentas = new Map<string, CuentaUsuario>();
  readonly identidades = new Map<string, string>();

  async buscarPorId(id: string) {
    return this.copia(this.cuentas.get(id));
  }
  async buscarPorEmail(email: string) {
    return this.copia([...this.cuentas.values()].find((c) => c.email === email));
  }
  async buscarPorIdentidad(proveedor: ProveedorOidc, sujeto: string) {
    const id = this.identidades.get(`${proveedor}:${sujeto}`);
    return id ? this.buscarPorId(id) : null;
  }
  async crear(n: NuevoUsuario): Promise<CuentaUsuario> {
    if ([...this.cuentas.values()].some((c) => c.email === n.email)) {
      throw new ConflictoError('CORREO_REGISTRADO', 'Ya existe una cuenta con ese correo');
    }
    if (n.numeroDocumento && [...this.cuentas.values()].some((c) => c.tipoDocumento === n.tipoDocumento && c.numeroDocumento === n.numeroDocumento)) {
      throw new ConflictoError('DOCUMENTO_REGISTRADO', 'Ya existe una cuenta con ese documento');
    }
    const cuenta: CuentaUsuario = {
      id: randomUUID(),
      email: n.email,
      nombre: n.nombre,
      tipoDocumento: n.tipoDocumento ?? null,
      numeroDocumento: n.numeroDocumento ?? null,
      fechaNacimiento: n.fechaNacimiento ?? null,
      passwordHash: n.passwordHash ?? null,
      mfaSecretoCifrado: null,
      debeCambiarPassword: n.debeCambiarPassword ?? false,
      emailVerificado: n.emailVerificado,
      activo: true,
      creadoEn: new Date(),
      ultimoIngresoEn: null,
      roles: [{ ...n.rol, id: randomUUID(), asignadoEn: new Date() }],
    };
    this.cuentas.set(cuenta.id, cuenta);
    if (n.identidad) this.identidades.set(`${n.identidad.proveedor}:${n.identidad.sujeto}`, cuenta.id);
    return this.copia(cuenta)!;
  }
  async vincularIdentidad(usuarioId: string, proveedor: ProveedorOidc, sujeto: string) {
    this.identidades.set(`${proveedor}:${sujeto}`, usuarioId);
  }
  async actualizarPassword(id: string, hash: string | null, opciones: { verificarCorreo?: boolean } = {}) {
    const c = this.cuentas.get(id)!;
    c.passwordHash = hash;
    c.debeCambiarPassword = false;
    if (opciones.verificarCorreo) c.emailVerificado = true;
  }
  async marcarCorreoVerificado(id: string) {
    this.cuentas.get(id)!.emailVerificado = true;
  }
  async guardarMfa(id: string, secreto: string | null) {
    this.cuentas.get(id)!.mfaSecretoCifrado = secreto;
  }
  async registrarIngreso(id: string, instante: Date) {
    this.cuentas.get(id)!.ultimoIngresoEn = instante;
  }
  async actualizar(id: string, cambios: CambiosUsuario) {
    Object.assign(this.cuentas.get(id)!, Object.fromEntries(Object.entries(cambios).filter(([, v]) => v !== undefined)));
  }
  async asignarRol(usuarioId: string, a: AsignacionRol): Promise<AsignacionGuardada> {
    const c = this.cuentas.get(usuarioId)!;
    const repetida = c.roles.some((r) => r.rol === a.rol && r.agenciaId === a.agenciaId && r.servicioId === a.servicioId);
    if (repetida) throw new ConflictoError('ROL_YA_ASIGNADO', 'La persona ya tiene ese rol con ese ámbito');
    const nueva = { ...a, id: randomUUID(), asignadoEn: new Date() };
    c.roles.push(nueva);
    return nueva;
  }
  async revocarRol(usuarioId: string, asignacionId: string) {
    const c = this.cuentas.get(usuarioId)!;
    const antes = c.roles.length;
    c.roles = c.roles.filter((r) => r.id !== asignacionId);
    return c.roles.length < antes;
  }
  async contarSuperadminsActivos() {
    return [...this.cuentas.values()].filter((c) => c.activo && c.roles.some((r) => r.rol === 'SUPERADMIN')).length;
  }
  async listar(f: FiltroUsuarios): Promise<PaginaUsuarios> {
    const todos = [...this.cuentas.values()].filter(
      (c) =>
        (!f.texto || `${c.nombre} ${c.email}`.toLowerCase().includes(f.texto.toLowerCase())) &&
        (!f.rol || c.roles.some((r) => r.rol === f.rol)) &&
        (!f.agencias || c.roles.some((r) => r.agenciaId && f.agencias!.includes(r.agenciaId))) &&
        (f.activo === undefined || c.activo === f.activo),
    );
    const inicio = (f.pagina - 1) * f.tamano;
    return { elementos: todos.slice(inicio, inicio + f.tamano).map((c) => this.copia(c)!), total: todos.length };
  }
  private copia(c?: CuentaUsuario): CuentaUsuario | null {
    return c ? { ...c, roles: c.roles.map((r) => ({ ...r })) } : null;
  }
}

/** Hash falso y rápido: solo para pruebas de los casos de uso (el real es Argon2id). */
export class HasherFalso implements PasswordHasherPort {
  async hash(clave: string) {
    return `hash:${clave}`;
  }
  async verificar(hash: string, clave: string) {
    return hash === `hash:${clave}`;
  }
}

export class AlmacenEnMemoria implements AlmacenTemporalPort {
  private readonly datos = new Map<string, { valor: string; venceEn: number }>();
  constructor(private readonly reloj: RelojControlable) {}

  async guardar<T>(clave: string, valor: T, ttl: number) {
    this.datos.set(clave, { valor: JSON.stringify(valor), venceEn: this.reloj.ms() + ttl * 1000 });
  }
  async obtener<T>(clave: string): Promise<T | null> {
    const d = this.datos.get(clave);
    if (!d || d.venceEn <= this.reloj.ms()) return null;
    return JSON.parse(d.valor) as T;
  }
  async consumir<T>(clave: string): Promise<T | null> {
    const valor = await this.obtener<T>(clave);
    this.datos.delete(clave);
    return valor;
  }
  async eliminar(clave: string) {
    this.datos.delete(clave);
  }
  async guardarSiNoExiste(clave: string, ttl: number) {
    if (await this.obtener(clave)) return false;
    await this.guardar(clave, 1, ttl);
    return true;
  }
  claves(): string[] {
    return [...this.datos.keys()];
  }
}

export class LimitadorEnMemoria implements LimitadorPort {
  private readonly contadores = new Map<string, { n: number; venceEn: number }>();
  constructor(private readonly reloj: RelojControlable) {}

  async bloqueadoPor(clave: string, maximo: number) {
    const c = this.contadores.get(clave);
    if (!c || c.venceEn <= this.reloj.ms() || c.n < maximo) return 0;
    return Math.ceil((c.venceEn - this.reloj.ms()) / 1000);
  }
  async registrarFallo(clave: string, ventana: number) {
    const c = this.contadores.get(clave);
    const vigente = c && c.venceEn > this.reloj.ms() ? c : { n: 0, venceEn: this.reloj.ms() + ventana * 1000 };
    vigente.n += 1;
    this.contadores.set(clave, vigente);
    return vigente.n;
  }
  async reiniciar(clave: string) {
    this.contadores.delete(clave);
  }
}

export class SesionesEnMemoria implements SesionesPort {
  readonly activas = new Map<string, Sesion>();
  readonly revocados = new Set<string>();

  async crear(sesion: Sesion) {
    const token = randomUUID();
    this.activas.set(token, sesion);
    return token;
  }
  async rotar(token: string) {
    const sesion = this.activas.get(token);
    if (!sesion) return null;
    this.activas.delete(token);
    return { token: await this.crear(sesion), sesion };
  }
  async cerrar(token: string) {
    this.activas.delete(token);
  }
  async cerrarTodas(usuarioId: string) {
    for (const [token, s] of this.activas) if (s.usuarioId === usuarioId) this.activas.delete(token);
  }
  async revocarAcceso(jti: string) {
    this.revocados.add(jti);
  }
  de(usuarioId: string): number {
    return [...this.activas.values()].filter((s) => s.usuarioId === usuarioId).length;
  }
}

export class EmisorFalso implements EmisorTokensPort {
  emitidos: { usuarioId: string; roles: AsignacionRol[]; amr: string[] }[] = [];
  async emitirAcceso(usuarioId: string, roles: AsignacionRol[], amr: string[]): Promise<TokenAcceso> {
    this.emitidos.push({ usuarioId, roles, amr });
    return { token: `acceso-${this.emitidos.length}`, jti: randomUUID(), expiraEn: 600 };
  }
}

/** Cifrado reversible de juguete: las pruebas del cifrado real están en su propio archivo. */
export class CifradorFalso implements CifradorPort {
  cifrar(texto: string) {
    return `cifrado:${texto}`;
  }
  descifrar(cifrado: string) {
    return cifrado.replace(/^cifrado:/, '');
  }
}

export class BuzonEnMemoria implements CorreoPort {
  readonly enviados: MensajeCorreo[] = [];
  async enviar(m: MensajeCorreo) {
    this.enviados.push(m);
  }
  /** Token del último enlace enviado a esa dirección. */
  ultimoToken(para: string): string {
    const m = [...this.enviados].reverse().find((e) => e.para === para);
    const token = m?.texto.match(/token=([\w-]+)/)?.[1];
    if (!token) throw new Error(`No hay enlaces para ${para}`);
    return token;
  }
}

export class AuditoriaEnMemoria implements AuditLogPort {
  readonly entradas: EntradaAuditoria[] = [];
  async registrar(e: EntradaAuditoria) {
    this.entradas.push(e);
  }
  acciones(): string[] {
    return this.entradas.map((e) => e.accion);
  }
}
