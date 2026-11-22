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

/** Instante de una fecha AAAA-MM-DD y hora HH:MM locales. Colombia no tiene horario de verano: siempre UTC−5. */
export function instanteLocal(fecha: string, hora: string): Date {
  return new Date(`${fecha}T${hora}:00-05:00`);
}

/** Franja de 30 minutos que contiene el instante, por ejemplo 09:30 (dimensión de la analítica). */
export function franjaDe(instante: Date, zona = ZONA_AGENCIAS): string {
  const [hora, minuto] = horaLocal(instante, zona).split(':');
  return `${hora}:${Number(minuto) < 30 ? '00' : '30'}`;
}
