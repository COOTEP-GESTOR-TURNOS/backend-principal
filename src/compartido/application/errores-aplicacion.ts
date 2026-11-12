/** Un servicio interno (motor de filas, analítica, base de datos) no respondió a tiempo. HTTP 503. */
export class ServicioNoDisponibleError extends Error {
  readonly codigo = 'SERVICIO_NO_DISPONIBLE';

  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ServicioNoDisponibleError';
  }
}
