import { describe, it, expect } from 'vitest';
import { EmailConfigSchema } from './email-config';
import { sendEmailWith, EmailSendError, type MailTransport } from './mailer';

describe('EmailConfigSchema', () => {
  it('accepts smtp and smtps URLs with a From that carries an address', () => {
    expect(
      EmailConfigSchema.parse({
        serverUrl: ' smtp://user:p%40ss@smtp.example.com:587 ',
        from: 'Scribe <no-reply@example.com>',
      }),
    ).toEqual({
      serverUrl: 'smtp://user:p%40ss@smtp.example.com:587',
      from: 'Scribe <no-reply@example.com>',
    });
    expect(
      EmailConfigSchema.safeParse({ serverUrl: 'smtps://h:465', from: 'a@b.co' }).success,
    ).toBe(true);
  });

  it('rejects non-SMTP schemes, hostless URLs and a From without an address', () => {
    expect(EmailConfigSchema.safeParse({ serverUrl: 'https://x', from: 'a@b.co' }).success).toBe(
      false,
    );
    expect(EmailConfigSchema.safeParse({ serverUrl: 'smtp://', from: 'a@b.co' }).success).toBe(
      false,
    );
    expect(EmailConfigSchema.safeParse({ serverUrl: 'smtp://h:25', from: 'Scribe' }).success).toBe(
      false,
    );
  });
});

describe('sendEmailWith', () => {
  const config = { serverUrl: 'smtp://h:25', from: 'Scribe <s@example.com>' };

  it('sends through the injected transport with the configured From', async () => {
    const calls: unknown[] = [];
    const transport: MailTransport = {
      async sendMail(message) {
        calls.push(message);
        return { rejected: [], pending: [] };
      },
    };
    await sendEmailWith(
      config,
      { to: ['a@x.io', 'b@x.io'], subject: 's', text: 't', html: '<p>h</p>' },
      () => transport,
    );
    expect(calls).toEqual([
      {
        from: 'Scribe <s@example.com>',
        to: 'a@x.io, b@x.io',
        subject: 's',
        text: 't',
        html: '<p>h</p>',
      },
    ]);
  });

  it('throws when the server rejects a recipient or there is nobody to send to', async () => {
    const rejecting: MailTransport = {
      async sendMail() {
        return { rejected: ['a@x.io'] };
      },
    };
    await expect(
      sendEmailWith(
        config,
        { to: ['a@x.io'], subject: 's', text: 't', html: 'h' },
        () => rejecting,
      ),
    ).rejects.toBeInstanceOf(EmailSendError);
    await expect(
      sendEmailWith(config, { to: [], subject: 's', text: 't', html: 'h' }, () => rejecting),
    ).rejects.toBeInstanceOf(EmailSendError);
  });
});
