import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { getTestPrisma, truncateAll } from '../test/db';
import { AuthorizationError, type Actor } from '../auth/authorize';
import {
  UserManagementError,
  deleteInvitation,
  inviteUser,
  listTeam,
  recordSignIn,
  setUserStatus,
  updateUserRole,
} from './user-service';
import { resolveDigestRecipients } from './pipeline-service';

const db = getTestPrisma();

let admin: Actor;
let editor: Actor;

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
});

describe('inviteUser', () => {
  it('only ADMIN may invite; the row is INVITED and audited in the same transaction', async () => {
    await expect(inviteUser(db, editor, { email: 'x@test.local', role: 'VIEWER' })).rejects.toThrow(
      AuthorizationError,
    );

    const invited = await inviteUser(db, admin, { email: ' New@Test.local ', role: 'EDITOR' });
    expect(invited.email).toBe('new@test.local');

    const row = await db.user.findUniqueOrThrow({ where: { id: invited.id } });
    expect(row).toMatchObject({ status: 'INVITED', role: 'EDITOR', invitedById: admin.id });
    expect(row.invitedAt).toBeInstanceOf(Date);

    const audit = await db.auditLog.findFirstOrThrow({ where: { action: 'user.invited' } });
    expect(audit).toMatchObject({
      actorId: admin.id,
      entityId: invited.id,
      metadata: { role: 'EDITOR' },
    });
  });

  it('rejects malformed email and duplicate accounts', async () => {
    await expect(inviteUser(db, admin, { email: 'nope', role: 'VIEWER' })).rejects.toMatchObject({
      name: 'ZodError',
    });
    await expect(
      inviteUser(db, admin, { email: 'editor@test.local', role: 'VIEWER' }),
    ).rejects.toThrow(UserManagementError);
  });

  it('listTeam resolves the inviter email and is ADMIN-only', async () => {
    const invited = await inviteUser(db, admin, { email: 'new@test.local', role: 'VIEWER' });
    const team = await listTeam(db, admin);
    expect(team.find((m) => m.id === invited.id)?.invitedByEmail).toBe('admin@test.local');
    expect(team.find((m) => m.id === admin.id)?.invitedByEmail).toBeNull();
    await expect(listTeam(db, editor)).rejects.toThrow(AuthorizationError);
  });
});

describe('recordSignIn', () => {
  it('activates an invitation, stamps lastLoginAt and emailVerified, audits once', async () => {
    const invited = await inviteUser(db, admin, { email: 'new@test.local', role: 'VIEWER' });
    await recordSignIn(db, invited.id);
    const row = await db.user.findUniqueOrThrow({ where: { id: invited.id } });
    expect(row.status).toBe('ACTIVE');
    expect(row.lastLoginAt).toBeInstanceOf(Date);
    expect(row.emailVerified).toBeInstanceOf(Date);

    await recordSignIn(db, invited.id);
    expect(await db.auditLog.count({ where: { action: 'user.invitationAccepted' } })).toBe(1);
  });
});

describe('roles and status', () => {
  it('changes a role with an audit row carrying from/to', async () => {
    await updateUserRole(db, admin, editor.id, 'ADMIN');
    expect((await db.user.findUniqueOrThrow({ where: { id: editor.id } })).role).toBe('ADMIN');
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: 'user.roleChanged' } });
    expect(audit.metadata).toMatchObject({ from: 'EDITOR', to: 'ADMIN' });
  });

  it('refuses to demote or disable the last active admin', async () => {
    await expect(updateUserRole(db, admin, admin.id, 'EDITOR')).rejects.toThrow(
      /last active admin/,
    );
    await expect(setUserStatus(db, admin, admin.id, 'DISABLED')).rejects.toThrow(
      UserManagementError,
    );
    // A second ACTIVE admin lifts the guard; an INVITED admin does not count.
    const invitedAdmin = await inviteUser(db, admin, { email: 'a2@test.local', role: 'ADMIN' });
    await expect(updateUserRole(db, admin, admin.id, 'EDITOR')).rejects.toThrow(
      /last active admin/,
    );
    await recordSignIn(db, invitedAdmin.id);
    await updateUserRole(db, admin, admin.id, 'EDITOR');
    expect((await db.user.findUniqueOrThrow({ where: { id: admin.id } })).role).toBe('EDITOR');
  });

  it('disables and re-enables with audits; never lets you disable yourself', async () => {
    await setUserStatus(db, admin, editor.id, 'DISABLED');
    expect((await db.user.findUniqueOrThrow({ where: { id: editor.id } })).status).toBe('DISABLED');
    await setUserStatus(db, admin, editor.id, 'ACTIVE');
    expect(
      await db.auditLog.count({ where: { action: { in: ['user.disabled', 'user.enabled'] } } }),
    ).toBe(2);
    await expect(setUserStatus(db, admin, admin.id, 'DISABLED')).rejects.toThrow(/your own/);
    await expect(setUserStatus(db, editor, admin.id, 'DISABLED')).rejects.toThrow(
      AuthorizationError,
    );
  });

  it('deletes only unused invitations', async () => {
    const invited = await inviteUser(db, admin, { email: 'new@test.local', role: 'VIEWER' });
    await expect(deleteInvitation(db, admin, editor.id)).rejects.toThrow(/unused invitations/);
    await deleteInvitation(db, admin, invited.id);
    expect(await db.user.findUnique({ where: { id: invited.id } })).toBeNull();
    expect(await db.auditLog.count({ where: { action: 'user.invitationDeleted' } })).toBe(1);
  });

  it('digest recipients skip invited and disabled accounts', async () => {
    await inviteUser(db, admin, { email: 'pending@test.local', role: 'EDITOR' });
    await setUserStatus(db, admin, editor.id, 'DISABLED');
    expect(await resolveDigestRecipients(db, [])).toEqual(['admin@test.local']);
  });
});
