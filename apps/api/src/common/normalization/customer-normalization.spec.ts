import { normalizeSearchText, normalizePhone, normalizeAddressText } from './customer-normalization';

describe('customer-normalization', () => {
  describe('normalizeSearchText', () => {
    it('removes accents', () => {
      expect(normalizeSearchText('María')).toBe('maria');
      expect(normalizeSearchText('José')).toBe('jose');
      expect(normalizeSearchText('García')).toBe('garcia');
    });

    it('lowercases', () => {
      expect(normalizeSearchText('MARÍA')).toBe('maria');
      expect(normalizeSearchText('Maria')).toBe('maria');
    });

    it('handles full names', () => {
      expect(normalizeSearchText('María García')).toBe('maria garcia');
      expect(normalizeSearchText('José López')).toBe('jose lopez');
      expect(normalizeSearchText('Jean Carlos')).toBe('jean carlos');
    });

    it('collapses multiple spaces', () => {
      expect(normalizeSearchText('  María   García  ')).toBe('maria garcia');
    });

    it('handles null/undefined', () => {
      expect(normalizeSearchText(null)).toBe('');
      expect(normalizeSearchText(undefined)).toBe('');
    });

    it('handles empty string', () => {
      expect(normalizeSearchText('')).toBe('');
    });
  });

  describe('normalizePhone', () => {
    it('keeps 10-digit colombian numbers', () => {
      expect(normalizePhone('3237963047')).toBe('3237963047');
    });

    it('strips 57 prefix from 12-digit numbers', () => {
      expect(normalizePhone('573237963047')).toBe('3237963047');
    });

    it('removes spaces and symbols', () => {
      expect(normalizePhone('+57 323 796 3047')).toBe('3237963047');
      expect(normalizePhone('57 323 796 3047')).toBe('3237963047');
      expect(normalizePhone('323-796-3047')).toBe('3237963047');
      expect(normalizePhone('(323) 796 3047')).toBe('3237963047');
    });

    it('returns null for invalid numbers', () => {
      expect(normalizePhone('123')).toBeNull();
      expect(normalizePhone('abc')).toBeNull();
    });

    it('handles null/undefined', () => {
      expect(normalizePhone(null)).toBeNull();
      expect(normalizePhone(undefined)).toBeNull();
    });
  });

  describe('normalizeAddressText', () => {
    it('trims and lowercases', () => {
      expect(normalizeAddressText('  Calle 10  ')).toBe('calle 10');
    });

    it('collapses multiple spaces', () => {
      expect(normalizeAddressText('Calle   10   #5-20')).toBe('calle 10 5-20');
    });

    it('handles accents', () => {
      expect(normalizeAddressText('Jamundí')).toBe('jamundi');
    });

    it('handles long addresses', () => {
      expect(normalizeAddressText('Condados de la Alborada')).toBe('condados de la alborada');
    });

    it('handles null/undefined', () => {
      expect(normalizeAddressText(null)).toBe('');
      expect(normalizeAddressText(undefined)).toBe('');
    });
  });
});
