import { Role, type UserStatus, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { authorize, type Actor } from '../auth/authorize';
import { recordAudit } from '../audit/audit-log';
import type { Db } from '../db/types';
import { createAuthToken, type IssuedCode } from './auth-service';

/**
 * Team management (Spec §10.2, §1.4): who can sign in and with which role.
 *
 * An invitation is a pre-created User row with status INVITED plus a
 * single-use invite code (auth-service). The invitee redeems the code on
 * /join, sets a password and the row becomes ACTIVE. Delivery of the code is
 * the admin's choice: Scribe emails it when SMTP is configured and always
 * shows it on the Team page to hand over by other means.
 *
 * Every mutation is gated by `authorize(actor, 'user.manage')` and writes its
 * AuditLog row in the same transaction (Spec §10.1.4, §10.1.6).
 */

/** Operator-facing failure; the message is safe to show in the UI. */
export class UserManagementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserManagementError';
  }
}

export const InviteUserSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
  role: z.nativeEnum(Role),
});

export interface TeamMember {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  status: UserStatus;
  createdAt: Date;
  invitedAt: Date | null;
  lastLoginAt: Date | null;
  /** Email of the inviter, resolved for display; null for bootstrap users. */
  invitedByEmail: string | null;
}

export async function listTeam(db: PrismaClient, actor: Actor): Promise<TeamMember[]> {
  authorize(actor, 'user.manage');
  const users = await db.user.findMany({
    orderBy: [{ createdAt: 'asc' }],
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      status: true,
      createdAt: true,
      invitedAt: true,
      lastLoginAt: true,
      invitedById: true,
    },
  });
  const byId = new Map(users.map((u) => [u.id, u.email] as const));
  return users.map(({ invitedById, ...u }) => ({
    ...u,
    invitedByEmail: invitedById ? (byId.get(invitedById) ?? null) : null,
  }));
}

/**
 * Pre-create the row and the invite code the invitee will redeem on /join.
 * The code is returned once; only its hash is stored.
 */
export async function inviteUser(
  db: PrismaClient,
  actor: Actor,
  input: unknown,
): Promise<{ id: string; email: string; role: Role } & IssuedCode> {
  authorize(actor, 'user.manage');
  const { email, role } = InviteUserSchema.parse(input);

  const existing = await db.user.findUnique({ where: { email }, select: { status: true } });
  if (existing) {
    throw new UserManagementError(
      existing.status === 'DISABLED'
        ? 'That account exists but is disabled. Enable it instead of inviting again.'
        : 'That email already has an account.',
    );
  }

  return db.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email,
        role,
        status: 'INVITED',
        invitedById: actor.id,
        invitedAt: new Date(),
      },
      select: { id: true, email: true, role: true },
    });
    await recordAudit(tx, {
      actorId: actor.id,
      actorType: 'human',
      action: 'user.invited',
      entityType: 'User',
      entityId: user.id,
      metadata: { role },
    });
    const issued = await createAuthToken(tx, {
      userId: user.id,
      purpose: 'INVITE',
      createdById: actor.id,
    });
    return { ...user, ...issued };
  });
}

/** True when `userId` is the only ACTIVE ADMIN, i.e. removing their access would orphan the instance. */
async function isLastActiveAdmin(db: Db, userId: string): Promise<boolean> {
  const target = await db.user.findUnique({
    where: { id: userId },
    select: { role: true, status: true },
  });
  if (!target || target.role !== 'ADMIN' || target.status !== 'ACTIVE') return false;
  const others = await db.user.count({
    where: { role: 'ADMIN', status: 'ACTIVE', NOT: { id: userId } },
  });
  return others === 0;
}

export async function updateUserRole(
  db: PrismaClient,
  actor: Actor,
  userId: string,
  role: Role,
): Promise<void> {
  authorize(actor, 'user.manage');
  z.nativeEnum(Role).parse(role);
  await db.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (!user) throw new UserManagementError('User not found.');
    if (user.role === role) return;
    if (role !== 'ADMIN' && (await isLastActiveAdmin(tx, userId))) {
      throw new UserManagementError('Cannot demote the last active admin.');
    }
    await tx.user.update({ where: { id: userId }, data: { role } });
    await recordAudit(tx, {
      actorId: actor.id,
      actorType: 'human',
      action: 'user.roleChanged',
      entityType: 'User',
      entityId: userId,
      metadata: { from: user.role, to: role },
    });
  });
}

export async function setUserStatus(
  db: PrismaClient,
  actor: Actor,
  userId: string,
  status: Extract<UserStatus, 'ACTIVE' | 'DISABLED'>,
): Promise<void> {
  authorize(actor, 'user.manage');
  if (status === 'DISABLED' && userId === actor.id) {
    throw new UserManagementError('You cannot disable your own account.');
  }
  await db.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { status: true } });
    if (!user) throw new UserManagementError('User not found.');
    if (user.status === status) return;
    if (status === 'DISABLED' && (await isLastActiveAdmin(tx, userId))) {
      throw new UserManagementError('Cannot disable the last active admin.');
    }
    await tx.user.update({ where: { id: userId }, data: { status } });
    await recordAudit(tx, {
      actorId: actor.id,
      actorType: 'human',
      action: status === 'DISABLED' ? 'user.disabled' : 'user.enabled',
      entityType: 'User',
      entityId: userId,
      metadata: { from: user.status, to: status },
    });
  });
}

/** Withdraw an invitation that was never used. Active accounts are disabled, never deleted. */
export async function deleteInvitation(
  db: PrismaClient,
  actor: Actor,
  userId: string,
): Promise<void> {
  authorize(actor, 'user.manage');
  await db.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { status: true, email: true },
    });
    if (!user) throw new UserManagementError('User not found.');
    if (user.status !== 'INVITED') {
      throw new UserManagementError(
        'Only unused invitations can be deleted. Disable the account instead.',
      );
    }
    // Audit first: the row's FK target (actorId) is the admin, not the invitee.
    await recordAudit(tx, {
      actorId: actor.id,
      actorType: 'human',
      action: 'user.invitationDeleted',
      entityType: 'User',
      entityId: userId,
    });
    await tx.user.delete({ where: { id: userId } });
  });
}

// ── Called by the web app's session layer, not by an admin ─────────────────────

/** Live access facts for the JWT refresh; null when the row is gone. */
export async function getUserAccess(
  db: PrismaClient,
  userId: string,
): Promise<{ role: Role; status: UserStatus } | null> {
  return db.user.findUnique({ where: { id: userId }, select: { role: true, status: true } });
}

export async function countUsers(db: PrismaClient): Promise<number> {
  return db.user.count();
}
