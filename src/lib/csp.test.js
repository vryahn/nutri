import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';

// The CSP pins the inline theme script by hash. Editing index.html without updating
// vercel.json silently blocks that script in production — it already happened once.
describe('CSP inline script hashes', () => {
  it('every inline <script> in index.html is allowed by the CSP in vercel.json', () => {
    const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
    const csp = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'))
      .headers.flatMap((h) => h.headers)
      .find((h) => h.key === 'Content-Security-Policy').value;
    const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)];
    expect(inline.length).toBeGreaterThan(0);
    for (const [, body] of inline) {
      const hash = 'sha256-' + createHash('sha256').update(body).digest('base64');
      expect(csp).toContain(hash);
    }
  });
});
