/** Zona horaria de las agencias. En la base de datos todo se guarda en UTC. */
export const ZONA_AGENCIAS = 'America/Bogota';

/** Fecha local AAAA-MM-DD de un instante. */
export function fechaLocal(instante: Date, zona = ZONA_AGENCIAS): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zona,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instante);
}

/** Hora local HH:MM (24 h) de un instante. */
export function horaLocal(instante: Date, zona = ZONA_AGENCIAS): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: zona,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(instante);
}

/** Franja de 30 minutos que contiene el instante, por ejemplo 09:30 (dimensión de la analítica). */
export function franjaDe(instante: Date, zona = ZONA_AGENCIAS): string {
  const [hora, minuto] = horaLocal(instante, zona).split(':');
  return `${hora}:${Number(minuto) < 30 ? '00' : '30'}`;
}
