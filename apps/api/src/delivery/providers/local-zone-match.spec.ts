import { matchLocalZone, normalizeLocalZoneText } from './local-zone-match';

describe('matchLocalZone', () => {
  describe('valid local-free address', () => {
    it.each(['Condados', 'Alborada', 'La Alborada', 'Barrio Alborada', 'Condados de la Alborada'])(
      'matches exact known alias: %s',
      (addressText) => {
        const result = matchLocalZone({ addressText });
        expect(result.matched).toBe(true);
        expect(result.ambiguous).toBe(false);
        expect(result.confidence).toBe('HIGH');
      },
    );

    it.each(['vivo en alborada', 'barrio condados', 'sector la alborada'])(
      'matches a short, digit-free zone reference with minimal filler: %s',
      (addressText) => {
        const result = matchLocalZone({ addressText });
        expect(result.matched).toBe(true);
        expect(result.confidence).toBe('MEDIUM');
      },
    );
  });

  describe('ambiguous alias text', () => {
    it.each(['cerca de alborada', 'por condados', 'cerca a alborada', 'al lado de condados', 'via alborada'])(
      'flags ambiguous proximity phrasing: %s',
      (addressText) => {
        const result = matchLocalZone({ addressText });
        expect(result.matched).toBe(false);
        expect(result.ambiguous).toBe(true);
      },
    );
  });

  describe('alias embedded in an unrelated/invalid address', () => {
    it.each([
      'Calle 15 #45-67 barrio condados sector industrial',
      'Carrera 10 con 20 apto 302 condados',
      'Manzana 5 casa 12 alborada etapa 2',
      'xxxxx condados xxxxx 99999 direccion inventada',
    ])('does NOT grant LOCAL_FREE for a full/invalid address that merely contains the alias: %s', (addressText) => {
      const result = matchLocalZone({ addressText });
      expect(result.matched).toBe(false);
      expect(result.ambiguous).toBe(false);
    });

    it('does NOT grant LOCAL_FREE when the alias is buried in a long unrelated sentence', () => {
      const result = matchLocalZone({
        addressText: 'mi casa queda en alborada cerca del parque y la tienda de la esquina detras del colegio',
      });
      expect(result.matched).toBe(false);
    });

    it('still requires digits-free short reference even via the neighborhood field', () => {
      const result = matchLocalZone({ neighborhood: 'Torre 3 apto 501 condados' });
      expect(result.matched).toBe(false);
    });
  });

  it('normalizes accents, case and punctuation before matching', () => {
    const result = matchLocalZone({ addressText: '  CÓNDADOS   de la   ALBORADA  ' });
    expect(result.matched).toBe(true);
    expect(result.confidence).toBe('HIGH');
  });

  it('normalizeLocalZoneText strips diacritics and punctuation deterministically', () => {
    expect(normalizeLocalZoneText('Cóndados, de LA Álborada!!')).toBe('condados de la alborada');
  });

  it('returns no match for an address with no local-zone signal at all', () => {
    const result = matchLocalZone({ addressText: 'Carrera 22 #10-15, Jamundí' });
    expect(result.matched).toBe(false);
    expect(result.ambiguous).toBe(false);
  });
});
