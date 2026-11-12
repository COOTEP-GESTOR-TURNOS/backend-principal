/**
 * Errores del dominio. No conocen HTTP: el filtro de la capa de infraestructura
 * los traduce a Problem Details (RFC 9457) con su código de estado.
 */
export class ErrorDeDominio extends Error {
  constructor(
    readonly codigo: string,
    mensaje: string,
  ) {
    super(mensaje);
    this.name = new.target.name;
  }
}

/** Choca con el estado actual o con una regla de unicidad (HTTP 409). */
export class ConflictoError extends ErrorDeDominio {}

/** Incumple una regla de negocio aunque los datos sean válidos (HTTP 422). */
export class ReglaNegocioError extends ErrorDeDominio {}

/** El recurso no existe o el usuario no debe saber que existe (HTTP 404). */
export class NoEncontradoError extends ErrorDeDominio {}

/** El rol o el ámbito del usuario no permiten la acción (HTTP 403). */
export class PermisoDenegadoError extends ErrorDeDominio {}

/** RN-04: solo se aceptan las transiciones del ciclo de vida del turno. */
export class TransicionInvalidaError extends ConflictoError {
  constructor(desde: string, hacia: string) {
    super('TRANSICION_INVALIDA', `Un turno ${desde} no puede pasar a ${hacia}`);
  }
}
