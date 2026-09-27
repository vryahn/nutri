import { describe, expect, it } from 'vitest';
import { todayISO } from './domain.js';
import { demoLangFromSearch, demoLoginPath } from './demo.js';

describe('demo entry values', () => {
  it('accepts only supported URL languages', () => {
    expect(demoLangFromSearch('?lang=en')).toBe('en');
    expect(demoLangFromSearch('?lang=fr')).toBeNull();
    expect(demoLangFromSearch('')).toBeNull();
    expect(demoLoginPath('?lang=en&demo=1')).toBe('/login?demo=1&lang=en');
    expect(demoLoginPath('?demo=1')).toBe('/login?demo=1');
  });

  it('formats the visitor local day across a UTC date boundary', () => {
    const previousTimezone = process.env.TZ;
    try {
      process.env.TZ = 'America/Mexico_City';
      expect(todayISO(new Date('2026-09-27T01:00:00.000Z'))).toBe('2026-09-26');
    } finally {
      if (previousTimezone === undefined) delete process.env.TZ;
      else process.env.TZ = previousTimezone;
    }
  });
});
