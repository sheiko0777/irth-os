import { describe, expect, it } from 'vitest';
// @ts-ignore
import config from '../../../next.config';

describe('next.config.ts', () => {
  it('should have security headers for /(.*)', async () => {
    // next-intl wraps the config. If we just require the default, it's a function (or object if older)
    // @ts-ignore - TS thinks config is never when ignoring the module import
    const resolvedConfig = typeof config === 'function' ? await config('phase-production-server', {}) : config;

    expect(resolvedConfig.headers).toBeDefined();
    const headersConfig = await resolvedConfig.headers();
    const allRoutesHeader = headersConfig.find((h: any) => h.source === '/(.*)');

    expect(allRoutesHeader).toBeDefined();

    const headers = allRoutesHeader.headers;

    const getHeader = (key: string) => headers.find((h: any) => h.key === key)?.value;

    expect(getHeader('Strict-Transport-Security')).toBe('max-age=63072000; includeSubDomains');
    expect(getHeader('X-Content-Type-Options')).toBe('nosniff');
    expect(getHeader('X-Frame-Options')).toBe('DENY');
    expect(getHeader('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(getHeader('Permissions-Policy')).toBe('camera=(), microphone=(), geolocation=()');
    expect(getHeader('Content-Security-Policy')).toBe("frame-ancestors 'none'");
  });
});
