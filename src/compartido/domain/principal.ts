/** Quién hace la petición: su identificador y sus roles con ámbito (RN-14, RN-15). */
export type Rol = 'SUPERADMIN' | 'ADMIN_AGENCIA' | 'FUNCIONARIO' | 'ASOCIADO';

export interface AsignacionRol {
  rol: Rol;
  /** Ámbito: agencia del administrador o del funcionario. */
  agenciaId?: string;
  /** Ámbito opcional del funcionario: sin servicio atiende todos los de su agencia. */
  servicioId?: string;
}

export interface Principal {
  id: string;
  roles: AsignacionRol[];
}

export function tieneRol(principal: Principal, ...roles: Rol[]): boolean {
  return principal.roles.some((asignacion) => roles.includes(asignacion.rol));
}

/** RN-14: solo administradores de la agencia y funcionarios de esa fila la operan. */
export function puedeOperarFila(principal: Principal, agenciaId: string, servicioId: string): boolean {
  return principal.roles.some(
    (r) =>
      (r.rol === 'ADMIN_AGENCIA' && r.agenciaId === agenciaId) ||
      (r.rol === 'FUNCIONARIO' && r.agenciaId === agenciaId && (!r.servicioId || r.servicioId === servicioId)),
  );
}
