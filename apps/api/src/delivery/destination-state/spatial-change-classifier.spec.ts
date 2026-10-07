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
    // INSTRUCTION_VOCABULARY, so they are AMBIGUOUS (unrecognized) segments, not INSTRUCTION —
    // unlike "cerca del parque" (recognized instruction vocabulary via "cerca").
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
});
