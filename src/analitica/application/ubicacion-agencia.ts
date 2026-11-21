import type { UbicacionAgenciaPutumayo } from './ports/out/demanda.port';

// DIVIPOLA departamento 86. Los municipios homónimos necesitan un departamento en el catálogo.
const MUNICIPIOS_PUTUMAYO = new Set([
  'mocoa', 'orito', 'puerto asis', 'puerto caicedo', 'puerto guzman', 'puerto leguizamo',
  'leguizamo', 'sibundoy', 'valle del guamuez', 'villagarzon',
]);

export function ubicacionAgenciaPutumayo(municipio: string): UbicacionAgenciaPutumayo | undefined {
  const normalizado = municipio.normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase();
  return MUNICIPIOS_PUTUMAYO.has(normalizado) ? { departamento: 'PUTUMAYO', municipio } : undefined;
}
