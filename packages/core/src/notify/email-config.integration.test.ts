import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { getTestPrisma, truncateAll } from '../test/db';
import { AuthorizationError, type Actor } from '../auth/authorize';
import {
  clearEmailConfig,
  getEmailConfigSummary,
  resolveEmailConfig,
  setEmailConfig,
} from './email-config';
import { sendEmail, type MailTransport } from './mailer';

const db = getTestPrisma();
let admin: Actor;
let editor: Actor;
const savedEnv = { server: process.env.EMAIL_SERVER, from: process.env.EMAIL_FROM };

beforeAll(async () => {
  await db.$connect();
});
afterAll(async () => {
  await db.$disconnect();
});
beforeEach(async () => {
  await truncateAll(db);
  const a = await db.user.create({ data: { email: 'admin@test.local', role: 'ADMIN' } });
  const e = await db.user.create({ data: { email: 'editor@test.local', role: 'EDITOR' } });
  admin = { id: a.id, role: 'ADMIN' };
  editor = { id: e.id, role: 'EDITOR' };
  delete process.env.EMAIL_SERVER;
  delete process.env.EMAIL_FROM;
});
afterEach(() => {
  if (savedEnv.server === undefined) delete process.env.EMAIL_SERVER;
  else process.env.EMAIL_SERVER = savedEnv.server;
  if (savedEnv.from === undefined) delete process.env.EMAIL_FROM;
  else process.env.EMAIL_FROM = savedEnv.from;
});

const input = {
  serverUrl: 'smtp://u:secret-pass@mail.test.local:587',
  from: 'Scribe <s@test.local>',
};

describe('email config (Spec §10.3: secrets encrypted at rest)', () => {
  it('nothing configured: summary says none and resolve returns null', async () => {
    expect(await getEmailConfigSummary(db, admin)).toMatchObject({
      configured: false,
      source: 'none',
      hasStoredConfig: false,
      hasEnvFallback: false,
    });
    expect(await resolveEmailConfig(db)).toBeNull();
  });

  it('only ADMIN may write; the row is ciphertext and the write is audited', async () => {
    await expect(setEmailConfig(db, editor, input)).rejects.toThrow(AuthorizationError);
    await setEmailConfig(db, admin, input);

    const row = await db.providerCredential.findUniqueOrThrow({ where: { provider: 'smtp' } });
    expect(row.credentialsEnc).not.toContain('secret-pass');
    expect(row.credentialsEnc).not.toContain('mail.test.local');
    expect(
      await db.auditLog.count({
        where: { action: 'providerCredential.updated', entityId: 'smtp', actorId: admin.id },
      }),
    ).toBe(1);

    expect(await resolveEmailConfig(db)).toEqual({ config: input, source: 'stored' });
    // The summary exposes the From (not secret) but never the URL.
    const summary = await getEmailConfigSummary(db, editor);
    expect(summary).toMatchObject({ configured: true, source: 'stored', from: input.from });
    expect(JSON.stringify(summary)).not.toContain('secret-pass');
  });

  it('rejects an invalid URL before touching the database', async () => {
    await expect(
      setEmailConfig(db, admin, { serverUrl: 'https://not-smtp', from: 'a@b.co' }),
    ).rejects.toMatchObject({ name: 'ZodError' });
    expect(await db.providerCredential.count()).toBe(0);
  });

  it('stored config wins over env; clearing falls back to env and is audited', async () => {
    process.env.EMAIL_SERVER = 'smtp://env:pw@env.test.local:25';
    process.env.EMAIL_FROM = 'Env <env@test.local>';
    expect(await resolveEmailConfig(db)).toMatchObject({ source: 'env' });

    await setEmailConfig(db, admin, input);
    expect(await resolveEmailConfig(db)).toMatchObject({ source: 'stored' });
    expect(await getEmailConfigSummary(db, admin)).toMatchObject({
      hasStoredConfig: true,
      hasEnvFallback: true,
    });

    await expect(clearEmailConfig(db, editor)).rejects.toThrow(AuthorizationError);
    await clearEmailConfig(db, admin);
    expect(await resolveEmailConfig(db)).toMatchObject({ source: 'env' });
    expect(await db.auditLog.count({ where: { action: 'providerCredential.cleared' } })).toBe(1);
  });

  it('sendEmail resolves the stored config and uses its From', async () => {
    const seen: string[] = [];
    const transport: MailTransport = {
      async sendMail(m) {
        seen.push(`${m.from}|${m.to}`);
        return {};
      },
    };
    expect(
      await sendEmail(
        db,
        { to: ['x@test.local'], subject: 's', text: 't', html: 'h' },
        () => transport,
      ),
    ).toBe(false);
    await setEmailConfig(db, admin, input);
    expect(
      await sendEmail(
        db,
        { to: ['x@test.local'], subject: 's', text: 't', html: 'h' },
        () => transport,
      ),
    ).toBe(true);
    expect(seen).toEqual(['Scribe <s@test.local>|x@test.local']);
  });
});
