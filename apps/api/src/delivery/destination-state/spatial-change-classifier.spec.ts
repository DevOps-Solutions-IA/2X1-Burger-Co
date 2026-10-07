import { classifyReferenceTextChange } from './spatial-change-classifier';
import { normalizeAddressText } from '../../common/normalization/customer-normalization';

// These tests exercise the exact bug confirmed on origin/main's resolveDeliverySnapshot
// (RULE 3): a purely non-spatial text edit (delivery note/instruction) must not be classified
// the same as a real spatial edit, because the caller uses the classification to decide
// whether previously-trusted GPS coordinates may still be trusted.
describe('classifyReferenceTextChange (RULE 3)', () => {
  const n = (text: string) => normalizeAddressText(text);

  it('classifies a pure instruction-text edit (same street+number) as NON_SPATIAL', () => {
    const previous = n('Carrera 10 # 20-30, casa azul');
    const next = n('Carrera 10 # 20-30, porton negro');
    const result = classifyReferenceTextChange(previous, next);
    expect(result.classification).toBe('NON_SPATIAL');
  });

  it('classifies identical normalized text as NON_SPATIAL (TEXT_UNCHANGED)', () => {
    const previous = n('Calle 5 # 6-7');
    const next = n('Calle 5 # 6-7');
    const result = classifyReferenceTextChange(previous, next);
    expect(result).toEqual({ classification: 'NON_SPATIAL', reason: 'TEXT_UNCHANGED' });
  });

  it('classifies a real street/number change as SPATIAL', () => {
    const previous = n('Carrera 10 # 20-30, casa azul');
    const next = n('Carrera 55 # 80-12, casa azul');
    const result = classifyReferenceTextChange(previous, next);
    expect(result.classification).toBe('SPATIAL');
  });

  it('fails closed to AMBIGUOUS when neither side has a recognizable spatial segment', () => {
    const previous = n('cerca del parque');
    const next = n('frente a la tienda');
    const result = classifyReferenceTextChange(previous, next);
    expect(result.classification).toBe('AMBIGUOUS');
  });

  it('fails closed to AMBIGUOUS when an unrecognized segment changes alongside a stable street', () => {
    // "patio con flores moradas" / "jardin con limonero" match neither STREET_KEYWORDS nor
    // INSTRUCTION_VOCABULARY, so they are AMBIGUOUS (unrecognized) segments.
    const previous = n('Carrera 10 # 20-30, patio con flores moradas');
    const next = n('Carrera 10 # 20-30, jardin con limonero');
    const result = classifyReferenceTextChange(previous, next);
    expect(result.classification).toBe('AMBIGUOUS');
  });

  it('never classifies a change as NON_SPATIAL without a proven spatial baseline on both sides', () => {
    const previous = n('casa azul');
    const next = n('Carrera 10 # 20-30, casa azul');
    const result = classifyReferenceTextChange(previous, next);
    expect(result.classification).not.toBe('NON_SPATIAL');
  });

  // ALTO-1 (independent review, 2026-10-07): a real change of neighborhood/municipality must
  // never classify NON_SPATIAL just because both sides share an informal-location word that used
  // to be misclassified as a pure "instruction" (frente/al lado/cerca/esquina/entrada/edificio/
  // local/conjunto). These words were removed from INSTRUCTION_VOCABULARY precisely so these
  // segments fall through to AMBIGUOUS (fail-closed) instead of being silently ignored.
  it('ALTO-1: fails closed on a real neighborhood change disguised behind "frente a"', () => {
    const previous = n('calle 50, frente al parque de belen');
    const next = n('calle 50, frente al parque de laureles');
    const result = classifyReferenceTextChange(previous, next);
    expect(result.classification).not.toBe('NON_SPATIAL');
    expect(result.classification).toBe('AMBIGUOUS');
  });

  it('ALTO-1: fails closed on a real municipality change disguised behind "al lado de"', () => {
    const previous = n('calle 50, al lado de la iglesia de envigado');
    const next = n('calle 50, al lado de la iglesia de itagui');
    const result = classifyReferenceTextChange(previous, next);
    expect(result.classification).not.toBe('NON_SPATIAL');
    expect(result.classification).toBe('AMBIGUOUS');
  });

  it('ALTO-1 control: the same neighborhood change without instruction-style wording was already AMBIGUOUS', () => {
    const previous = n('calle 50, parque de belen');
    const next = n('calle 50, parque de laureles');
    const result = classifyReferenceTextChange(previous, next);
    expect(result.classification).toBe('AMBIGUOUS');
  });

  it('ALTO-1: genuine access-note-only vocabulary (color/timbre/porton) still classifies NON_SPATIAL', () => {
    const previous = n('Carrera 10 # 20-30, timbre no funciona, avisar al porton');
    const next = n('Carrera 10 # 20-30, timbre dañado, avisar en el porton');
    const result = classifyReferenceTextChange(previous, next);
    expect(result.classification).toBe('NON_SPATIAL');
  });
});
