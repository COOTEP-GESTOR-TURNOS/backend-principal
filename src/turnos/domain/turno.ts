import { ReglaNegocioError, TransicionInvalidaError } from '../../compartido/domain/errores';
import { fechaLocal } from '../../compartido/domain/tiempo';
import { ESTADOS_ACTIVOS, EstadoTurno, nombreEvento, TRANSICIONES } from './estado-turno';
import type { EventoTurno } from './evento-turno';
import type { Canal, TipoAtencion } from './tipos';

export interface DatosTurno {
  id: string;
  agenciaId: string;
  servicioId: string;
  asociadoId: string;
  fecha: string; // AAAA-MM-DD, hora local de la agencia
  numero: number | null;
  codigo: string | null;
  tipoAtencion: TipoAtencion;
  estado: EstadoTurno;
  canal: Canal;
  motivo: string | null;
  solicitadoEn: Date;
  proximoEn: Date | null;
  confirmadoEn: Date | null;
  llamadoEn: Date | null;
  inicioAtencionEn: Date | null;
  finEn: Date | null;
  atendidoPor: string | null;
  verificadoPor: string | null;
  idempotencyKey: string | null;
  version: number;
}

export interface SolicitudTurno {
  id: string;
  agenciaId: string;
  servicioId: string;
  asociadoId: string;
  tipoAtencion: TipoAtencion;
  canal: Canal;
  ahora: Date;
  idempotencyKey?: string | null;
}

/**
 * Agregado Turno: concentra la máquina de estados (RN-04) y registra un evento por cada cambio.
 * No depende de NestJS ni de ninguna base de datos.
 */
export class Turno {
  private eventos: EventoTurno[] = [];

  private constructor(private readonly d: DatosTurno) {}

  static solicitar(s: SolicitudTurno): Turno {
    const turno = new Turno({
      id: s.id,
      agenciaId: s.agenciaId,
      servicioId: s.servicioId,
      asociadoId: s.asociadoId,
      fecha: fechaLocal(s.ahora),
      numero: null,
      codigo: null,
      tipoAtencion: s.tipoAtencion,
      estado: EstadoTurno.SOLICITADO,
      canal: s.canal,
      motivo: null,
      solicitadoEn: s.ahora,
      proximoEn: null,
      confirmadoEn: null,
      llamadoEn: null,
      inicioAtencionEn: null,
      finEn: null,
      atendidoPor: null,
      verificadoPor: null,
      idempotencyKey: s.idempotencyKey ?? null,
      version: 0,
    });
    turno.registrar(null, EstadoTurno.SOLICITADO, s.asociadoId, s.ahora);
    return turno;
  }

  /** Reconstruye el agregado desde la base de datos, sin eventos pendientes. */
  static reconstruir(datos: DatosTurno): Turno {
    return new Turno({ ...datos });
  }

  get id(): string {
    return this.d.id;
  }
  get asociadoId(): string {
    return this.d.asociadoId;
  }
  get agenciaId(): string {
    return this.d.agenciaId;
  }
  get servicioId(): string {
    return this.d.servicioId;
  }
  get filaId(): string {
    return `${this.d.agenciaId}:${this.d.servicioId}`;
  }
  get estado(): EstadoTurno {
    return this.d.estado;
  }
  get numero(): number | null {
    return this.d.numero;
  }
  get codigo(): string | null {
    return this.d.codigo;
  }
  get tipoAtencion(): TipoAtencion {
    return this.d.tipoAtencion;
  }
  get confirmado(): boolean {
    return this.d.confirmadoEn !== null;
  }
  get motivo(): string | null {
    return this.d.motivo;
  }
  get version(): number {
    return this.d.version;
  }

  estaActivo(): boolean {
    return ESTADOS_ACTIVOS.has(this.d.estado);
  }

  perteneceA(asociadoId: string): boolean {
    return this.d.asociadoId === asociadoId;
  }

  /** RN-02: el número lo asigna el motor de filas al encolar. */
  asignarNumero(numero: number, codigo: string): void {
    if (this.d.estado !== EstadoTurno.SOLICITADO || this.d.numero !== null) {
      throw new ReglaNegocioError('NUMERO_YA_ASIGNADO', 'El turno ya tiene número');
    }
    this.d.numero = numero;
    this.d.codigo = codigo;
  }

  ponerEnEspera(ahora: Date): void {
    this.cambiarA(EstadoTurno.EN_ESPERA, null, ahora);
  }

  /** RN-10: desde aquí corre el tiempo T_CONFIRMACION. */
  marcarProximo(ahora: Date): void {
    this.cambiarA(EstadoTurno.PROXIMO, null, ahora);
    this.d.proximoEn = ahora;
  }

  /** RN-10: el asociado confirma que viene. Idempotente: confirmar dos veces devuelve false. */
  confirmarPresencia(ahora: Date): boolean {
    if (this.d.estado !== EstadoTurno.PROXIMO && this.d.estado !== EstadoTurno.LLAMADO) {
      throw new ReglaNegocioError('CONFIRMACION_FUERA_DE_TIEMPO', 'Solo se confirma un turno próximo o llamado');
    }
    if (this.d.confirmadoEn) return false;
    this.d.confirmadoEn = ahora;
    this.registrar(this.d.estado, this.d.estado, this.d.asociadoId, ahora, 'TurnoConfirmado');
    return true;
  }

  /** Si la fila avanzó rápido y el turno seguía En espera, pasa por Próximo antes de Llamado. */
  llamar(funcionarioId: string, ahora: Date): void {
    if (this.d.estado === EstadoTurno.EN_ESPERA) {
      this.cambiarA(EstadoTurno.PROXIMO, funcionarioId, ahora);
      this.d.proximoEn = ahora;
    }
    this.cambiarA(EstadoTurno.LLAMADO, funcionarioId, ahora);
    this.d.llamadoEn = ahora;
    this.d.atendidoPor = funcionarioId;
  }

  iniciarAtencion(funcionarioId: string, ahora: Date): void {
    this.cambiarA(EstadoTurno.EN_ATENCION, funcionarioId, ahora);
    this.d.inicioAtencionEn = ahora;
  }

  /** Idempotente: finalizar un turno ya atendido no cambia nada y devuelve false. */
  finalizar(funcionarioId: string, ahora: Date): boolean {
    if (this.d.estado === EstadoTurno.ATENDIDO) return false;
    this.cambiarA(EstadoTurno.ATENDIDO, funcionarioId, ahora);
    this.d.finEn = ahora;
    return true;
  }

  /** Idempotente. RN-12: al cancelarse, el turno sale de la fila y libera RN-01. */
  cancelar(motivo: string, actorId: string | null, ahora: Date): boolean {
    if (this.d.estado === EstadoTurno.CANCELADO) return false;
    this.cambiarA(EstadoTurno.CANCELADO, actorId, ahora);
    this.d.motivo = motivo;
    this.d.finEn = ahora;
    return true;
  }

  /** Idempotente. RN-10 y RN-11: no confirmó a tiempo o no se presentó al llamado. */
  marcarAusente(motivo: string, actorId: string | null, ahora: Date): boolean {
    if (this.d.estado === EstadoTurno.AUSENTE) return false;
    this.cambiarA(EstadoTurno.AUSENTE, actorId, ahora);
    this.d.motivo = motivo;
    this.d.finEn = ahora;
    return true;
  }

  /** RN-06 y RN-07: el funcionario verifica la condición; si no aplica, vuelve a la fila general. */
  verificarPreferencial(funcionarioId: string, cumple: boolean, ahora: Date): void {
    if (this.d.estado !== EstadoTurno.LLAMADO) {
      throw new ReglaNegocioError('VERIFICACION_FUERA_DE_TIEMPO', 'Solo se verifica un turno llamado');
    }
    if (this.d.tipoAtencion !== 'PREFERENCIAL') {
      throw new ReglaNegocioError('NO_ES_PREFERENCIAL', 'El turno no pidió atención preferencial');
    }
    this.d.verificadoPor = funcionarioId;
    if (!cumple) {
      this.d.tipoAtencion = 'GENERAL';
      this.d.llamadoEn = null;
      this.d.atendidoPor = null;
      this.cambiarA(EstadoTurno.EN_ESPERA, funcionarioId, ahora);
    }
  }

  /** Lo usa el repositorio después de guardar con bloqueo optimista. */
  alGuardar(nuevaVersion: number): void {
    this.d.version = nuevaVersion;
  }

  /** Entrega los eventos pendientes y los borra del agregado. */
  extraerEventos(): EventoTurno[] {
    const pendientes = this.eventos;
    this.eventos = [];
    return pendientes;
  }

  instantanea(): Readonly<DatosTurno> {
    return { ...this.d };
  }

  private cambiarA(nuevo: EstadoTurno, actorId: string | null, ahora: Date): void {
    const actual = this.d.estado;
    if (!TRANSICIONES[actual].includes(nuevo)) {
      throw new TransicionInvalidaError(actual, nuevo);
    }
    this.d.estado = nuevo;
    this.registrar(actual, nuevo, actorId, ahora);
  }

  private registrar(
    anterior: EstadoTurno | null,
    nuevo: EstadoTurno,
    actorId: string | null,
    ahora: Date,
    tipo = nombreEvento(nuevo),
  ): void {
    this.eventos.push({
      tipo,
      turnoId: this.d.id,
      agenciaId: this.d.agenciaId,
      servicioId: this.d.servicioId,
      asociadoId: this.d.asociadoId,
      tipoAtencion: this.d.tipoAtencion,
      estadoAnterior: anterior,
      estadoNuevo: nuevo,
      actorId,
      canal: this.d.canal,
      ocurridoEn: ahora,
      datos: this.d.codigo ? { codigo: this.d.codigo } : {},
    });
  }
}
