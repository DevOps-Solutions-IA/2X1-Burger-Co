import { hasZoneAddressComplement, matchLocalZone, normalizeLocalZoneText } from './local-zone-match';

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

    it.each([
      'barrio condados',
      'sector la alborada',
      'la alborada',
      'barrio alborada',
      'barrio condados',
      'urbanizacion condados',
      'sector la alborada',
      'condados de la alborada',
    ])('matches a bare zone reference composed only of alias + structural zone vocabulary: %s', (addressText) => {
      const result = matchLocalZone({ addressText });
      expect(result.matched).toBe(true);
      expect(result.ambiguous).toBe(false);
    });
  });

  describe('LOCAL_FREE must NOT match arbitrary prose around an alias (residual bypass regression)', () => {
    it.each([
      'vivo en alborada',
      'pedido alborada urgente',
      'entrega condados rapido',
      'mandalo a alborada',
      'direccion alborada',
      'cliente en condados',
      'casa alborada',
      'calle alborada',
      'carrera condados',
      'manzana alborada',
      'apto condados',
    ])('does NOT match: %s', (addressText) => {
      const result = matchLocalZone({ addressText });
      expect(result.matched).toBe(false);
    });

    it.each([
      'xxxxx alborada yyyy',
      'alborada centro',
      'condados norte',
      'cerca del alborada gigante',
      'este es un texto largo sin relacion que menciona alborada de pasada nada mas',
    ])('does NOT match arbitrary non-whitelisted prose containing the alias: %s', (addressText) => {
      const result = matchLocalZone({ addressText });
      expect(result.matched).toBe(false);
    });
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

  describe('CROSS_FIELD_BYPASS: a LOCAL_FREE match must depend on ALL supplied fields jointly, not on any single field in isolation', () => {
    it('does NOT match the red-team false positive: a real/distinct addressText plus a pure-alias reference', () => {
      const result = matchLocalZone({
        addressText: 'Calle 45 #12-34, Barrio Real Distante',
        reference: 'alborada',
      });
      expect(result.matched).toBe(false);
      expect(result.ambiguous).toBe(false);
    });

    it('does NOT match when addressText is a pure alias but neighborhood carries a real, numbered address', () => {
      const result = matchLocalZone({
        addressText: 'Alborada',
        neighborhood: 'Carrera 10 # 20-30',
      });
      expect(result.matched).toBe(false);
    });

    it('does NOT match when neighborhood is the pure alias but reference carries a numbered unit', () => {
      const result = matchLocalZone({
        neighborhood: 'Condados',
        reference: 'Apto 501 torre 3',
      });
      expect(result.matched).toBe(false);
    });

    it('does NOT match when a non-digit street designator (no digits at all) appears in a different field than the alias', () => {
      const result = matchLocalZone({
        addressText: 'Carrera Real Distante',
        reference: 'condados',
      });
      expect(result.matched).toBe(false);
    });

    it('does NOT match when the conflicting field is the SAME field family repeated across all three inputs except one', () => {
      const result = matchLocalZone({
        addressText: 'alborada',
        neighborhood: 'alborada',
        reference: 'Manzana 8 casa 45',
      });
      expect(result.matched).toBe(false);
    });

    it('DOES still match when the extra field is benign descriptive prose with no digits and no street designator (legitimate complement, not a bypass)', () => {
      const result = matchLocalZone({
        addressText: 'Alborada',
        reference: 'casa esquinera, porton azul, frente al parque',
      });
      expect(result.matched).toBe(true);
      expect(result.ambiguous).toBe(false);
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

describe('hasZoneAddressComplement (ZONE_ONLY_ADDRESS_COMPLETION support)', () => {
  it('is false for a bare zone label alone, in any single field', () => {
    expect(hasZoneAddressComplement({ addressText: 'Alborada' })).toBe(false);
    expect(hasZoneAddressComplement({ neighborhood: 'barrio condados' })).toBe(false);
    expect(hasZoneAddressComplement({ reference: 'condados de la alborada' })).toBe(false);
  });

  it('is false when the bare zone label is merely repeated across multiple fields', () => {
    expect(hasZoneAddressComplement({ addressText: 'Alborada', neighborhood: 'Alborada' })).toBe(false);
  });

  it('is true when a non-anchor field carries genuine descriptive content beyond the zone label', () => {
    expect(
      hasZoneAddressComplement({
        addressText: 'Alborada',
        reference: 'casa esquinera, porton azul, frente al parque',
      }),
    ).toBe(true);
  });

  it('is false when there is no input at all', () => {
    expect(hasZoneAddressComplement({})).toBe(false);
  });
});
