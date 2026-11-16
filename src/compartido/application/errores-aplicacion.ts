/** Un servicio interno (motor de filas, analítica, base de datos) no respondió a tiempo. HTTP 503. */
export class ServicioNoDisponibleError extends Error {
  readonly codigo = 'SERVICIO_NO_DISPONIBLE';

  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ServicioNoDisponibleError';
  }
}

/** Credenciales, sesión o enlace inválidos o vencidos. HTTP 401. */
export class NoAutenticadoError extends Error {
  constructor(
    readonly codigo: string,
    mensaje: string,
  ) {
    super(mensaje);
    this.name = 'NoAutenticadoError';
  }
}

/** Se superó el límite de intentos (inicio de sesión, código MFA o correos). HTTP 429. */
export class DemasiadosIntentosError extends Error {
  readonly codigo = 'DEMASIADOS_INTENTOS';

  constructor(
    mensaje: string,
    readonly reintentarEnSegundos?: number,
  ) {
    super(mensaje);
    this.name = 'DemasiadosIntentosError';
  }
}
