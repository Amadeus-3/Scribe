import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { getTestPrisma, truncateAll } from '../test/db';
import { AuthorizationError, type Actor } from '../auth/authorize';
import { inviteUser, setUserStatus } from './user-service';
import {
  AuthFlowError,
  authenticateWithPassword,
  bootstrapAdmin,
  changeOwnPassword,
  issueInviteCode,
  issuePasswordResetCode,
  needsSetup,
  redeemAuthCode,
  requestPasswordReset,
  setupTokenAccepted,
} from './auth-service';

const db = getTestPrisma();
const PW = 'correct horse battery';

beforeAll(async () => {
  await db.$connect();
});
afterAll(async () => {
  await db.$disconnect();
});
beforeEach(async () => {
  await truncateAll(db);
});

async function bootstrap(): Promise<Actor> {
  const admin = await bootstrapAdmin(db, { email: 'a@test.local', password: PW });
  return { id: admin.id, role: 'ADMIN' };
}

describe('bootstrapAdmin', () => {
  it('creates the only ADMIN on an empty instance, signed in and audited', async () => {
    expect(await needsSetup(db)).toBe(true);
    const admin = await bootstrapAdmin(db, {
      email: ' Owner@Test.local ',
      name: 'Owner',
      password: PW,
    });
    expect(admin).toMatchObject({ email: 'owner@test.local', role: 'ADMIN' });
    const row = await db.user.findUniqueOrThrow({ where: { id: admin.id } });
    expect(row).toMatchObject({ status: 'ACTIVE', name: 'Owner' });
    expect(row.passwordHash).not.toBeNull();
    expect(row.passwordHash).not.toContain(PW);
    expect(row.lastLoginAt).toBeInstanceOf(Date);
    expect(
      await db.auditLog.count({ where: { action: 'user.bootstrapped', actorId: admin.id } }),
    ).toBe(1);
    expect(await needsSetup(db)).toBe(false);
  });

  it('refuses once any account exists', async () => {
    await bootstrap();
    await expect(bootstrapAdmin(db, { email: 'b@test.local', password: PW })).rejects.toThrow(
      /already has an administrator/,
    );
    expect(await db.user.count()).toBe(1);
  });

  it('serialises concurrent submissions so exactly one wins', async () => {
    const results = await Promise.allSettled([
      bootstrapAdmin(db, { email: 'a@test.local', password: PW }),
      bootstrapAdmin(db, { email: 'b@test.local', password: PW }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await db.user.count()).toBe(1);
  });

  it('enforces the optional setup token', async () => {
    const guarded = { requiredSetupToken: 'secret-setup' };
    await expect(
      bootstrapAdmin(db, { email: 'a@test.local', password: PW }, guarded),
    ).rejects.toThrow(AuthFlowError);
    await expect(
      bootstrapAdmin(db, { email: 'a@test.local', password: PW, setupToken: 'wrong' }, guarded),
    ).rejects.toThrow(/setup token/i);
    expect(await db.user.count()).toBe(0);
    await bootstrapAdmin(
      db,
      { email: 'a@test.local', password: PW, setupToken: 'secret-setup' },
      guarded,
    );
    expect(setupTokenAccepted(undefined, undefined)).toBe(true);
    expect(setupTokenAccepted('anything', undefined)).toBe(true);
    expect(setupTokenAccepted(undefined, 'required')).toBe(false);
  });

  it('rejects weak passwords and bad emails before touching the database', async () => {
    await expect(bootstrapAdmin(db, { email: 'nope', password: PW })).rejects.toMatchObject({
      name: 'ZodError',
    });
    await expect(
      bootstrapAdmin(db, { email: 'a@test.local', password: 'short' }),
    ).rejects.toMatchObject({ name: 'ZodError' });
    expect(await db.user.count()).toBe(0);
  });
});

describe('authenticateWithPassword', () => {
  it('admits the right password, stamps lastLoginAt, and names the failure otherwise', async () => {
    const actor = await bootstrap();
    await db.user.update({ where: { id: actor.id }, data: { lastLoginAt: null } });

    const ok = await authenticateWithPassword(db, { email: 'A@test.local', password: PW });
    expect(ok).toEqual({ ok: true, user: { id: actor.id, email: 'a@test.local', role: 'ADMIN' } });
    const row = await db.user.findUniqueOrThrow({ where: { id: actor.id } });
    expect(row.lastLoginAt).toBeInstanceOf(Date);

    expect(
      await authenticateWithPassword(db, { email: 'a@test.local', password: 'nope-nope-nope' }),
    ).toEqual({ ok: false, reason: 'bad_password' });
    expect(await authenticateWithPassword(db, { email: 'ghost@test.local', password: PW })).toEqual(
      { ok: false, reason: 'unknown_email' },
    );
    expect(await authenticateWithPassword(db, { email: 'not-an-email', password: PW })).toEqual({
      ok: false,
      reason: 'invalid_input',
    });
    expect(await authenticateWithPassword(db, { email: 'a@test.local', password: '' })).toEqual({
      ok: false,
      reason: 'invalid_input',
    });
  });

  it('refuses invitations that never set a password, and disabled accounts', async () => {
    const actor = await bootstrap();
    const invited = await inviteUser(db, actor, { email: 'i@test.local', role: 'EDITOR' });
    expect(await authenticateWithPassword(db, { email: 'i@test.local', password: PW })).toEqual({
      ok: false,
      reason: 'no_password',
    });
    await redeemAuthCode(db, 'INVITE', { code: invited.code, password: PW });
    await setUserStatus(db, actor, invited.id, 'DISABLED');
    expect(await authenticateWithPassword(db, { email: 'i@test.local', password: PW })).toEqual({
      ok: false,
      reason: 'disabled',
    });
  });
});

describe('invite codes', () => {
  it('the code from inviteUser activates the account once, with a password', async () => {
    const actor = await bootstrap();
    const invited = await inviteUser(db, actor, { email: 'i@test.local', role: 'EDITOR' });

    const user = await redeemAuthCode(db, 'INVITE', { code: invited.code, password: PW });
    expect(user).toMatchObject({ id: invited.id, email: 'i@test.local', role: 'EDITOR' });
    const row = await db.user.findUniqueOrThrow({ where: { id: invited.id } });
    expect(row.status).toBe('ACTIVE');
    expect(row.emailVerified).toBeInstanceOf(Date);
    expect(
      await db.auditLog.count({
        where: { action: 'user.invitationAccepted', actorId: invited.id },
      }),
    ).toBe(1);

    await expect(
      redeemAuthCode(db, 'INVITE', { code: invited.code, password: PW }),
    ).rejects.toThrow(/already used/);
    expect((await authenticateWithPassword(db, { email: 'i@test.local', password: PW })).ok).toBe(
      true,
    );
  });

  it('a reissued code retires the previous one; expired codes fail; purposes do not mix', async () => {
    const actor = await bootstrap();
    const invited = await inviteUser(db, actor, { email: 'i@test.local', role: 'VIEWER' });
    const again = await issueInviteCode(db, actor, invited.id);
    expect(again.code).not.toBe(invited.code);
    expect(again).toMatchObject({ email: 'i@test.local', role: 'VIEWER' });

    await expect(
      redeemAuthCode(db, 'INVITE', { code: invited.code, password: PW }),
    ).rejects.toThrow(AuthFlowError);
    await expect(
      redeemAuthCode(db, 'PASSWORD_RESET', { code: again.code, password: PW }),
    ).rejects.toThrow(AuthFlowError);

    await db.authToken.updateMany({
      where: { userId: invited.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await expect(redeemAuthCode(db, 'INVITE', { code: again.code, password: PW })).rejects.toThrow(
      /expired/,
    );
    expect((await db.user.findUniqueOrThrow({ where: { id: invited.id } })).status).toBe('INVITED');
  });

  it('only admins reissue, and only for pending invitations', async () => {
    const actor = await bootstrap();
    const invited = await inviteUser(db, actor, { email: 'i@test.local', role: 'VIEWER' });
    await expect(
      issueInviteCode(db, { id: invited.id, role: 'VIEWER' }, invited.id),
    ).rejects.toThrow(AuthorizationError);
    await expect(issueInviteCode(db, actor, actor.id)).rejects.toThrow(/pending invitation/);
  });
});

describe('password reset', () => {
  it('admin-issued and operator-issued links set a new password once', async () => {
    const actor = await bootstrap();
    const byAdmin = await issuePasswordResetCode(db, actor, actor.id);
    await redeemAuthCode(db, 'PASSWORD_RESET', {
      code: byAdmin.code,
      password: 'brand new password',
    });
    expect((await authenticateWithPassword(db, { email: 'a@test.local', password: PW })).ok).toBe(
      false,
    );
    expect(
      (
        await authenticateWithPassword(db, {
          email: 'a@test.local',
          password: 'brand new password',
        })
      ).ok,
    ).toBe(true);

    const byOperator = await issuePasswordResetCode(db, null, actor.id);
    const audits = await db.auditLog.findMany({
      where: { action: 'user.passwordResetIssued' },
      orderBy: { createdAt: 'asc' },
    });
    expect(audits.map((a) => a.actorType)).toEqual(['human', 'system']);
    expect(audits[1]?.metadata).toMatchObject({ via: 'operator' });

    await redeemAuthCode(db, 'PASSWORD_RESET', {
      code: byOperator.code,
      password: 'third password!',
    });
    await expect(
      redeemAuthCode(db, 'PASSWORD_RESET', { code: byOperator.code, password: 'third password!' }),
    ).rejects.toThrow(AuthFlowError);
  });

  it('a non-admin cannot issue reset links, and disabled accounts get none', async () => {
    const actor = await bootstrap();
    const invited = await inviteUser(db, actor, { email: 'i@test.local', role: 'EDITOR' });
    await redeemAuthCode(db, 'INVITE', { code: invited.code, password: PW });
    await expect(
      issuePasswordResetCode(db, { id: invited.id, role: 'EDITOR' }, actor.id),
    ).rejects.toThrow(AuthorizationError);
    await setUserStatus(db, actor, invited.id, 'DISABLED');
    await expect(issuePasswordResetCode(db, actor, invited.id)).rejects.toThrow(/disabled/);
  });

  it('self-service reset is silent for unknown addresses and delivers for active ones', async () => {
    await bootstrap();
    const sent: Array<{ to: string; code: string }> = [];
    const deliver = async (to: string, issued: { code: string }): Promise<void> => {
      sent.push({ to, code: issued.code });
    };

    await requestPasswordReset(db, 'ghost@test.local', deliver);
    await requestPasswordReset(db, 'not an email', deliver);
    expect(sent).toHaveLength(0);
    expect(await db.authToken.count()).toBe(0);

    await requestPasswordReset(db, 'A@test.local', deliver);
    const first = sent[0];
    expect(first?.to).toBe('a@test.local');
    await redeemAuthCode(db, 'PASSWORD_RESET', {
      code: first?.code ?? '',
      password: 'brand new password',
    });
    expect(
      (
        await authenticateWithPassword(db, {
          email: 'a@test.local',
          password: 'brand new password',
        })
      ).ok,
    ).toBe(true);
    expect(
      await db.auditLog.count({
        where: {
          action: 'user.passwordResetIssued',
          metadata: { path: ['via'], equals: 'self_service' },
        },
      }),
    ).toBe(1);
  });

  it('changeOwnPassword needs the current password and voids outstanding reset links', async () => {
    const actor = await bootstrap();
    const reset = await issuePasswordResetCode(db, actor, actor.id);
    await expect(
      changeOwnPassword(db, actor, {
        currentPassword: 'wrong-wrong-wrong',
        newPassword: 'brand new password',
      }),
    ).rejects.toThrow(/current password/);
    await expect(
      changeOwnPassword(db, actor, { currentPassword: PW, newPassword: 'short' }),
    ).rejects.toMatchObject({ name: 'ZodError' });

    await changeOwnPassword(db, actor, { currentPassword: PW, newPassword: 'brand new password' });
    expect(
      (
        await authenticateWithPassword(db, {
          email: 'a@test.local',
          password: 'brand new password',
        })
      ).ok,
    ).toBe(true);
    await expect(
      redeemAuthCode(db, 'PASSWORD_RESET', { code: reset.code, password: 'another password!' }),
    ).rejects.toThrow(AuthFlowError);
    expect(
      await db.auditLog.count({
        where: { action: 'user.passwordChanged', metadata: { path: ['via'], equals: 'settings' } },
      }),
    ).toBe(1);
  });
});
