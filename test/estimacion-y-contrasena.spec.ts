import { franjaDe } from '../src/compartido/domain/tiempo';
import { PoliticaContrasena } from '../src/identidad/domain/politica-contrasena';
import { estimarEsperaMin } from '../src/turnos/domain/estimacion-espera';

describe('Estimación de espera', () => {
  const base = { personasDelante: 5, tAtencionMin: 4, ventanillas: 2, pPreferencial: 0.2, maxPreferencialesSeguidos: 2 };

  it('aplica n · t̄ / (v · (1 − p))', () => {
    expect(estimarEsperaMin({ ...base, esPreferencial: false })).toBe(12.5);
  });

  it('un turno preferencial no espera por los preferenciales que lleguen (p = 0)', () => {
    expect(estimarEsperaMin({ ...base, esPreferencial: true })).toBe(10);
  });

  it('limita p a K / (K + 1)', () => {
    expect(estimarEsperaMin({ ...base, pPreferencial: 0.9, esPreferencial: false })).toBe(30);
  });

  it('la franja de 30 minutos usa la hora de Colombia', () => {
    expect(franjaDe(new Date('2026-11-20T14:47:00Z'))).toBe('09:30');
  });
});

describe('Política de contraseñas (NIST SP 800-63B-4)', () => {
  it('sin MFA exige 15 caracteres', () => {
    expect(PoliticaContrasena.validar('catorce-caract', { tieneMfa: false })).toHaveLength(1);
    expect(PoliticaContrasena.validar('quince-caracter', { tieneMfa: false })).toEqual([]);
  });

  it('con MFA bastan 8 caracteres', () => {
    expect(PoliticaContrasena.validar('ocho-car', { tieneMfa: true })).toEqual([]);
  });

  it('acepta frases de 64 caracteres y rechaza contraseñas comunes', () => {
    const frase = 'una frase larga de sesenta y cuatro caracteres para el sistema!!';
    expect([...frase]).toHaveLength(64);
    expect(PoliticaContrasena.validar(frase, { tieneMfa: false })).toEqual([]);
    expect(PoliticaContrasena.validar('123456789012345', { tieneMfa: false })).toContain('Es una contraseña común; elija otra');
  });
});
