import {
  classifyComponentsChange,
  classifyRawReferenceChange,
  isSameSpatialDestination,
  spatialFingerprint,
  splitReferenceText,
} from './spatial-fingerprint';
import { EMPTY_SPATIAL_FINGERPRINT } from './destination-snapshot.types';

describe('spatialFingerprint — canonical spatial identity', () => {
  it('is deterministic for identical structured components', () => {
    const a = spatialFingerprint({ street: 'Calle 5', number: '10-20', neighborhood: 'Alborada', city: 'Cali' });
    const b = spatialFingerprint({ street: 'Calle 5', number: '10-20', neighborhood: 'Alborada', city: 'Cali' });
    expect(a).toBe(b);
    expect(a).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('treats Unicode NFKC / case / whitespace variants as the SAME destination', () => {
    const canonical = spatialFingerprint({ street: 'Calle 5', number: '10-20', neighborhood: 'Alborada', city: 'Cali' });
    const fullwidthDigits = spatialFingerprint({ street: 'ｃalle 5', number: '１０-20', neighborhood: 'alborada', city: 'CALI' });
    const extraWhitespace = spatialFingerprint({ street: '  Calle   5  ', number: '10-20', neighborhood: 'Alborada', city: 'Cali' });
    const accented = spatialFingerprint({ street: 'CÁLLE 5', number: '10-20', neighborhood: 'Albórada', city: 'Calí' });
    expect(fullwidthDigits).toBe(canonical);
    expect(extraWhitespace).toBe(canonical);
    expect(accented).toBe(canonical);
  });

  it('fails closed on homoglyph manipulation — a Cyrillic-substituted address never equals the real one', () => {
    const real = spatialFingerprint({ street: 'Calle 5', number: '10-20', neighborhood: 'Alborada', city: 'Cali' });
    // 'а' below (in "Cаlle") is Cyrillic U+0430, not Latin 'a' U+0061.
    const homoglyph = spatialFingerprint({ street: 'Cаlle 5', number: '10-20', neighborhood: 'Alborada', city: 'Cali' });
    expect(homoglyph).not.toBe(real);
    expect(isSameSpatialDestination(real, homoglyph)).toBe(false);
  });

  it('is order-sensitive per-field (cannot collide two different component splits)', () => {
    const a = spatialFingerprint({ street: 'a', number: 'b1' });
    const b = spatialFingerprint({ street: 'ab', number: '1' });
    expect(a).not.toBe(b);
  });

  it('returns the EMPTY sentinel for no spatial content, and EMPTY never equals itself via isSameSpatialDestination', () => {
    expect(spatialFingerprint({})).toBe(EMPTY_SPATIAL_FINGERPRINT);
    expect(spatialFingerprint({ street: '   ', number: null })).toBe(EMPTY_SPATIAL_FINGERPRINT);
    expect(isSameSpatialDestination(EMPTY_SPATIAL_FINGERPRINT, EMPTY_SPATIAL_FINGERPRINT)).toBe(false);
  });

  it('a real destination is never treated as equal to the EMPTY sentinel', () => {
    const real = spatialFingerprint({ street: 'Calle 5', number: '10-20' });
    expect(isSameSpatialDestination(real, EMPTY_SPATIAL_FINGERPRINT)).toBe(false);
  });

  it('distinguishes genuinely different destinations', () => {
    const a = spatialFingerprint({ street: 'Calle 5', number: '10-20', city: 'Cali' });
    const b = spatialFingerprint({ street: 'Calle 6', number: '10-20', city: 'Cali' });
    expect(a).not.toBe(b);
  });
});

describe('classifyComponentsChange — structured spatial vs non-spatial classification', () => {
  it('NEW_DESTINATION when there is no previous snapshot', () => {
    const result = classifyComponentsChange(null, { street: 'Calle 5', number: '10-20' });
    expect(result.classification).toBe('SPATIAL');
  });

  it('NON_SPATIAL when every spatial component is unchanged', () => {
    const previous = { street: 'Calle 5', number: '10-20', neighborhood: 'Alborada' };
    const next = { street: 'Calle 5', number: '10-20', neighborhood: 'Alborada' };
    expect(classifyComponentsChange(previous, next).classification).toBe('NON_SPATIAL');
  });

  it('SPATIAL when any spatial component changes (e.g. street number)', () => {
    const previous = { street: 'Calle 5', number: '10-20' };
    const next = { street: 'Calle 5', number: '10-25' };
    expect(classifyComponentsChange(previous, next).classification).toBe('SPATIAL');
  });

  it('never returns AMBIGUOUS for the structured path (unambiguous by construction)', () => {
    const previous = { street: 'Calle 5' };
    const next = { street: 'Calle 5 bis' };
    expect(classifyComponentsChange(previous, next).classification).not.toBe('AMBIGUOUS');
  });
});

describe('splitReferenceText — bounded heuristic for legacy single-combined-text field', () => {
  it('separates a street+number segment from an instruction segment', () => {
    const split = splitReferenceText('Calle 5 #10-20, casa azul');
    expect(split.spatialSegments).toContain('Calle 5 #10-20');
    expect(split.instructionSegments).toContain('casa azul');
  });

  it('classifies an unrecognized segment as ambiguous, not silently non-spatial', () => {
    const split = splitReferenceText('Calle 5 #10-20, xyzzy plugh');
    expect(split.ambiguousSegments.length).toBeGreaterThan(0);
  });
});

describe('classifyRawReferenceChange — CRITICAL finding fix (legacy POS combined reference field)', () => {
  it('RULE 3: a NON-SPATIAL-only edit ("casa azul" -> "portón negro") on the same address is NON_SPATIAL', () => {
    const result = classifyRawReferenceChange('Calle 5 #10-20, casa azul', 'Calle 5 #10-20, portón negro');
    expect(result.classification).toBe('NON_SPATIAL');
  });

  it('a genuinely spatial edit (house number changes) is SPATIAL', () => {
    const result = classifyRawReferenceChange('Calle 5 #10-20, casa azul', 'Calle 5 #10-25, casa azul');
    expect(result.classification).toBe('SPATIAL');
  });

  it('fails closed to AMBIGUOUS when the previous text has no provable spatial baseline', () => {
    const result = classifyRawReferenceChange('cerca del parque', 'cerca del parque, casa azul');
    expect(result.classification).toBe('AMBIGUOUS');
  });

  it('fails closed to AMBIGUOUS when an unrecognized segment changes alongside the address', () => {
    const result = classifyRawReferenceChange('Calle 5 #10-20, xyzzy', 'Calle 5 #10-20, plugh');
    expect(result.classification).toBe('AMBIGUOUS');
  });

  it('is NON_SPATIAL when only whitespace/case/accents differ in the address portion', () => {
    const result = classifyRawReferenceChange('Calle 5 #10-20, casa azul', '  CALLE   5 #10-20 , casa azul  ');
    expect(result.classification).toBe('NON_SPATIAL');
  });
});
