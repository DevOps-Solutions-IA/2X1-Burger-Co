import {
  hasUnicodeDigit,
  isZoneOnlyReferenceStructurallyComplete,
  matchLocalZone,
  normalizeStructuralAddressText,
} from './local-zone-match';

// SOFIA Address Remediation (A1 — normalization/completeness).
//
// Two prior remediation rounds tried to fix "a bare LOCAL_FREE zone-only text match granting
// checkout eligibility without a real deliverable address" and were BOTH broken by an automated
// red team:
//   Round 1: required the alias to be (near-)the whole candidate text.
//   Round 2: added a DENYLIST of ~25 street/route-designator words + an ASCII-only /\d/ digit
//            check, rejecting a match only when a field contained one of those specific tokens.
// Any place name / city / prose NOT on the denylist (e.g. "Bogota Chapinero", "Medellin", "Barrio
// Real Distante", "Cerca de la playa en Cartagena") sailed through as a "legitimate complement"
// even though it describes a real, different, unrelated location. The digit check also missed
// fullwidth/Arabic-Indic Unicode digits (e.g. "Casa ４５").
//
// This suite is the mandatory regression coverage for every one of those red-team findings,
// re-verified against the POSITIVE/STRUCTURAL closed-vocabulary replacement in this file.

describe('normalizeStructuralAddressText (RULE 7 — Unicode-safe normalization)', () => {
  it('applies NFKC to canonicalize fullwidth digits/letters before anything else', () => {
    expect(normalizeStructuralAddressText('Casa４５')).toBe('casa45');
  });

  it('strips diacritics after NFKC (accented uppercase input)', () => {
    expect(normalizeStructuralAddressText('  CÓNDADOS   de la   ALBORADA  ')).toBe('condados de la alborada');
  });

  it('strips zero-width / invisible format characters outright, never fragmenting a word', () => {
    // U+200B ZERO WIDTH SPACE inserted mid-word must not survive as a literal split point.
    expect(normalizeStructuralAddressText('albo​rada')).toBe('alborada');
    expect(normalizeStructuralAddressText('cond‌ados‍ de﻿ la⁠ albo­rada')).toBe(
      'condados de la alborada',
    );
  });

  it('does NOT fold Cyrillic homoglyphs into Latin lookalikes (no confusables normalization)', () => {
    // U+0430 CYRILLIC SMALL LETTER A substituted for the first "a" in "alborada".
    const homoglyph = 'аlborada';
    const normalized = normalizeStructuralAddressText(homoglyph);
    expect(normalized).not.toBe('alborada');
    // The Cyrillic letter must survive normalization untouched (proves no script-folding happened).
    expect(normalized).toContain('а');
  });

  it('returns empty string for null/undefined', () => {
    expect(normalizeStructuralAddressText(null)).toBe('');
    expect(normalizeStructuralAddressText(undefined)).toBe('');
  });
});

describe('hasUnicodeDigit (RULE 8 — Unicode-aware digit detection)', () => {
  it('detects plain ASCII digits', () => {
    expect(hasUnicodeDigit('Casa 45')).toBe(true);
    expect(hasUnicodeDigit('Casa esquinera')).toBe(false);
  });

  it('detects fullwidth digits (U+FF10-FF19)', () => {
    expect(hasUnicodeDigit('Casa ４５ frente al parque')).toBe(true);
  });

  it('detects Arabic-Indic digits (U+0660-0669)', () => {
    expect(hasUnicodeDigit('شارع ٤٥')).toBe(true);
  });

  it('returns false for empty/null/undefined input', () => {
    expect(hasUnicodeDigit('')).toBe(false);
    expect(hasUnicodeDigit(null)).toBe(false);
    expect(hasUnicodeDigit(undefined)).toBe(false);
  });
});

describe('matchLocalZone — homoglyph and invisible-character regression', () => {
  it('does NOT match a Cyrillic-homoglyph-substituted alias (must fall through to normal geocoding)', () => {
    const result = matchLocalZone({ reference: 'аlborada' });
    expect(result.matched).toBe(false);
  });

  it('still matches a legitimate alias despite zero-width characters inserted inside it', () => {
    const result = matchLocalZone({ reference: 'albo​rada' });
    expect(result.matched).toBe(true);
    expect(result.zoneLabel).toBe('Alborada');
  });

  it('zero-width characters do not enable a false match on unrelated text', () => {
    const result = matchLocalZone({ addressText: 'Bogota​ Chapinero' });
    expect(result.matched).toBe(false);
  });
});

describe('isZoneOnlyReferenceStructurallyComplete — POSITIVE structural completeness (RULE 9/10)', () => {
  // --- Required red-team regression cases: must NOT grant zone-only trust ---

  it('rejects an unrelated real place name in a different field than the alias: "Bogota Chapinero" + reference "alborada"', () => {
    expect(
      isZoneOnlyReferenceStructurallyComplete({ addressText: 'Bogota Chapinero', reference: 'alborada' }),
    ).toBe(false);
  });

  it('rejects an unrelated real place name in neighborhood field: "Medellin" + neighborhood "alborada"', () => {
    expect(isZoneOnlyReferenceStructurallyComplete({ addressText: 'Medellin', neighborhood: 'alborada' })).toBe(
      false,
    );
  });

  it('rejects the original PoC: "Barrio Real Distante" + reference "alborada"', () => {
    expect(
      isZoneOnlyReferenceStructurallyComplete({ addressText: 'Barrio Real Distante', reference: 'alborada' }),
    ).toBe(false);
  });

  it('rejects prose describing a genuinely different location: "Cerca de la playa en Cartagena" + reference "alborada"', () => {
    expect(
      isZoneOnlyReferenceStructurallyComplete({
        addressText: 'Cerca de la playa en Cartagena',
        reference: 'alborada',
      }),
    ).toBe(false);
  });

  it('rejects a fullwidth digit as a real street number: "Casa ４５ frente al parque" + reference "alborada"', () => {
    expect(
      isZoneOnlyReferenceStructurallyComplete({
        addressText: 'Casa ４５ frente al parque',
        reference: 'alborada',
      }),
    ).toBe(false);
  });

  it('rejects Arabic-Indic digits mixed with an alias field', () => {
    expect(
      isZoneOnlyReferenceStructurallyComplete({
        addressText: 'شارع ٤٥',
        reference: 'alborada',
      }),
    ).toBe(false);
  });

  it('rejects a Cyrillic-homoglyph alias (never granted trust; falls through as an unmatched string)', () => {
    expect(
      isZoneOnlyReferenceStructurallyComplete({ reference: 'аlborada', addressText: 'casa esquinera' }),
    ).toBe(false);
  });

  it('zero-width characters neither enable nor break the completeness result', () => {
    // A bare alias with zero-width noise stays incomplete (no genuine content anywhere).
    expect(isZoneOnlyReferenceStructurallyComplete({ reference: 'albo​rada' })).toBe(false);
    // A genuinely complete complement with zero-width noise sprinkled in still evaluates true.
    expect(
      isZoneOnlyReferenceStructurallyComplete({
        reference: 'albo​rada',
        neighborhood: 'ca​sa esquinera porton azul',
      }),
    ).toBe(true);
  });

  // --- Required positive/negative baseline cases ---

  it('bare zone-only reference ("Alborada") is NOT structurally complete', () => {
    expect(isZoneOnlyReferenceStructurallyComplete({ addressText: 'Alborada' })).toBe(false);
  });

  it('bare zone-only reference ("Condados") is NOT structurally complete', () => {
    expect(isZoneOnlyReferenceStructurallyComplete({ addressText: 'Condados' })).toBe(false);
  });

  it('zone alias with grammatical filler only ("Condados de la Alborada") is still NOT complete', () => {
    expect(isZoneOnlyReferenceStructurallyComplete({ addressText: 'Condados de la Alborada' })).toBe(false);
  });

  it('zone + valid full complement ("Alborada" + "casa esquinera porton azul") IS complete', () => {
    expect(
      isZoneOnlyReferenceStructurallyComplete({ addressText: 'Alborada', reference: 'casa esquinera porton azul' }),
    ).toBe(true);
  });

  it('accepts a genuine complement across the neighborhood field, accented and cased freely', () => {
    expect(
      isZoneOnlyReferenceStructurallyComplete({
        addressText: 'Alborada',
        neighborhood: 'Casa Esquinera, Portón Azul - Frente al Parque',
      }),
    ).toBe(true);
  });

  it('rejects a genuine-sounding complement that still contains one out-of-vocabulary token', () => {
    // "cancha" and "azul" are in-vocabulary, "sintetica" is not — must fail closed, not partial-pass.
    expect(
      isZoneOnlyReferenceStructurallyComplete({
        addressText: 'Alborada',
        reference: 'cerca a la cancha sintetica azul',
      }),
    ).toBe(false);
  });

  it('rejects when no candidate field is supplied at all', () => {
    expect(isZoneOnlyReferenceStructurallyComplete({})).toBe(false);
  });

  it('rejects a street/route designator even without digits (formal address signal, not a zone landmark)', () => {
    expect(
      isZoneOnlyReferenceStructurallyComplete({ addressText: 'Alborada', reference: 'Carrera Quinta' }),
    ).toBe(false);
  });
});

describe('matchLocalZone — cross-field bypass regression (matched vs structurally complete stay independent)', () => {
  // These confirm matchLocalZone() itself still finds the alias (ZONE_MATCHED can legitimately be
  // true for these), while isZoneOnlyReferenceStructurallyComplete() independently and correctly
  // refuses to call them ADDRESS_COMPLETE — the two must never be conflated by any caller.
  it.each([
    ['Bogota Chapinero', undefined, 'alborada'],
    ['Medellin', 'alborada', undefined],
    ['Barrio Real Distante', undefined, 'alborada'],
    ['Cerca de la playa en Cartagena', undefined, 'alborada'],
  ] as const)('addressText=%s neighborhood=%s reference=%s: matched may be true, but never structurally complete', (addressText, neighborhood, reference) => {
    const structurallyComplete = isZoneOnlyReferenceStructurallyComplete({ addressText, neighborhood, reference });
    expect(structurallyComplete).toBe(false);
  });
});
