import { edadEnAnios, PoliticaPreferencial } from '../src/turnos/domain/politica-preferencial';

const hoy = new Date('2026-11-20T14:00:00Z');
const base = { hoy, edadMinima: 60, autodeclarada: false };

describe('PR-05: política de atención preferencial (RN-05, RN-06)', () => {
  it('un asociado de 60 años es preferencial', () => {
    expect(PoliticaPreferencial.tipoAtencion({ ...base, fechaNacimiento: new Date('1966-11-20') })).toBe('PREFERENCIAL');
  });

  it('un asociado que cumple 60 mañana todavía es general', () => {
    expect(PoliticaPreferencial.tipoAtencion({ ...base, fechaNacimiento: new Date('1966-11-21') })).toBe('GENERAL');
  });

  it('la autodeclaración de gestante o discapacidad lo hace preferencial', () => {
    expect(PoliticaPreferencial.tipoAtencion({ ...base, fechaNacimiento: new Date('1995-01-01'), autodeclarada: true })).toBe(
      'PREFERENCIAL',
    );
  });

  it('sin fecha de nacimiento ni autodeclaración es general', () => {
    expect(PoliticaPreferencial.tipoAtencion({ ...base, fechaNacimiento: null })).toBe('GENERAL');
  });

  it('calcula la edad en años cumplidos', () => {
    expect(edadEnAnios(new Date('2000-02-29'), new Date('2026-02-28'))).toBe(25);
    expect(edadEnAnios(new Date('2000-02-29'), new Date('2026-03-01'))).toBe(26);
  });
});
