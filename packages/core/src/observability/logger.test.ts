import { describe, it, expect } from 'vitest';
import { createLogger, REDACT_PATHS } from './logger';

describe('logger redaction', () => {
  it('lists critical secret-bearing fields in the redaction paths', () => {
    for (const path of [
      'ANTHROPIC_API_KEY',
      'AUTH_SECRET',
      'ENCRYPTION_KEY',
      'cmsCredentialsEnc',
      '*.cmsCredentialsEnc',
      'password',
      '*.password',
    ]) {
      expect(REDACT_PATHS).toContain(path);
    }
  });

  it('masks secret-bearing fields in emitted log lines (Spec §10.1.3)', () => {
    const lines: string[] = [];
    const log = createLogger({
      service: 'test',
      level: 'info',
      destination: {
        write: (chunk: string) => {
          lines.push(chunk);
        },
      },
    });

    log.info(
      { password: 'hunter2', apiKey: 'sk-secret', nested: { token: 'tok-abc' }, safe: 'visible' },
      'message',
    );

    const output = lines.join('');
    expect(output).not.toContain('hunter2');
    expect(output).not.toContain('sk-secret');
    expect(output).not.toContain('tok-abc');
    expect(output).toContain('[REDACTED]');
    expect(output).toContain('visible');
  });
});
