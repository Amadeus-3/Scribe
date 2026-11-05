import type { AuthTokenPurpose, PrismaClient, Role } from '@prisma/client';
import { z } from 'zod';
import { authorize, type Actor } from '../auth/authorize';
import { recordAudit } from '../audit/audit-log';
import {
  INVITE_TTL_MS,
  PASSWORD_RESET_TTL_MS,
  constantTimeEquals,
  generateTokenSecret,
  hashTokenSecret,
} from '../auth/auth-token';
import {
  PASSWORD_MAX_LENGTH,
  PasswordSchema,
  hashPassword,
  verifyPassword,
} from '../auth/password';
import type { Db } from '../db/types';

/**
 * Email + password authentication (Spec §10.2: no open sign-up).
 *
 * Three doors into an account, all ending in a password:
 *  - /setup: the first visitor of an empty instance becomes ADMIN. Optional
 *    SETUP_TOKEN guards an instance that is public before its owner arrives.
 *  - invite code: an ADMIN creates an INVITED row (user-service) and hands
 *    over a single-use code; redeeming it sets the password and activates.
 *  - reset code: for an existing account, issued by an admin from the Team
 *    page, by the owner via email, or by the operator's recovery command.
 *
 * Nothing here needs SMTP. Every mutation writes its AuditLog row in the same
 * transaction (Spec §10.1.6); admin-only operations go through authorize().
 */

/** Operator-facing failure; the message is safe to show in the UI. */
export class AuthFlowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthFlowError';
  }
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: Role;
}

const EmailSchema = z.string().trim().toLowerCase().email('Enter a valid email address.');

// ── First administrator (/setup) ──────────────────────────────────────────────

export const SetupInputSchema = z.object({
  email: EmailSchema,
  name: z
    .string()
    .trim()
    .max(80, 'Keep the name under 80 characters.')
    .optional()
    .transform((v) => (v ? v : undefined)),
  password: PasswordSchema,
  setupToken: z.string().optional(),
});

/** True while the instance has no accounts at all. */
export async function needsSetup(db: PrismaClient): Promise<boolean> {
  return (await db.user.count()) === 0;
}

export function setupTokenAccepted(
  provided: string | undefined,
  required: string | undefined,
): boolean {
  if (!required) return true;
  if (!provided) return false;
  return constantTimeEquals(provided, required);
}

export async function bootstrapAdmin(
  db: PrismaClient,
  input: unknown,
  options: { requiredSetupToken?: string } = {},
): Promise<AuthenticatedUser> {
  const data = SetupInputSchema.parse(input);
  if (!setupTokenAccepted(data.setupToken, options.requiredSetupToken)) {
    throw new AuthFlowError(
      'The setup token is missing or wrong. It is SETUP_TOKEN in the server environment.',
    );
  }
  const passwordHash = await hashPassword(data.password);
  return db.$transaction(async (tx) => {
    // Two people submitting /setup at once must not both become admin: the
    // lock serialises them, and the loser sees a non-empty table.
    await tx.$executeRaw`LOCK TABLE "User" IN SHARE ROW EXCLUSIVE MODE`;
    if ((await tx.user.count()) > 0) {
      throw new AuthFlowError('This instance already has an administrator. Sign in instead.');
    }
    const now = new Date();
    const user = await tx.user.create({
      data: {
        email: data.email,
        name: data.name,
        role: 'ADMIN',
        status: 'ACTIVE',
        passwordHash,
        emailVerified: now,
        lastLoginAt: now,
      },
      select: { id: true, email: true, role: true },
    });
    await recordAudit(tx, {
      actorId: user.id,
      actorType: 'human',
      action: 'user.bootstrapped',
      entityType: 'User',
      entityId: user.id,
      metadata: { setupTokenRequired: Boolean(options.requiredSetupToken) },
    });
    return user;
  });
}

// ── Password sign-in ──────────────────────────────────────────────────────────

export type PasswordSignInFailure =
  | 'invalid_input'
  | 'unknown_email'
  | 'no_password'
  | 'disabled'
  | 'bad_password';

export type PasswordSignInResult =
  | { ok: true; user: AuthenticatedUser }
  | { ok: false; reason: PasswordSignInFailure };

const CredentialsSchema = z.object({
  email: EmailSchema,
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});

// A real hash to verify against when the email is unknown, so that path costs
// one scrypt like every other and timing does not reveal which emails exist.
let decoy: Promise<string> | undefined;
function decoyHash(): Promise<string> {
  decoy ??= hashPassword(generateTokenSecret());
  return decoy;
}

export async function authenticateWithPassword(
  db: PrismaClient,
  input: { email: unknown; password: unknown },
): Promise<PasswordSignInResult> {
  const parsed = CredentialsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: 'invalid_input' };

  const user = await db.user.findUnique({
    where: { email: parsed.data.email },
    select: { id: true, email: true, role: true, status: true, passwordHash: true },
  });
  const matches = await verifyPassword(
    parsed.data.password,
    user?.passwordHash ?? (await decoyHash()),
  );
  if (!user) return { ok: false, reason: 'unknown_email' };
  if (!user.passwordHash) return { ok: false, reason: 'no_password' };
  if (user.status === 'DISABLED') return { ok: false, reason: 'disabled' };
  if (!matches) return { ok: false, reason: 'bad_password' };

  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  return { ok: true, user: { id: user.id, email: user.email, role: user.role } };
}

// ── Single-use codes ──────────────────────────────────────────────────────────

export interface IssuedCode {
  /** The secret itself. Shown or sent once; never stored or logged. */
  code: string;
  expiresAt: Date;
}

/**
 * Mint a code inside the caller's transaction. Older unused codes of the same
 * purpose for this user are retired, so only the latest one works.
 */
export async function createAuthToken(
  tx: Db,
  input: { userId: string; purpose: AuthTokenPurpose; createdById?: string | null },
): Promise<IssuedCode> {
  const now = new Date();
  await tx.authToken.updateMany({
    where: { userId: input.userId, purpose: input.purpose, usedAt: null },
    data: { usedAt: now },
  });
  const code = generateTokenSecret();
  const ttl = input.purpose === 'INVITE' ? INVITE_TTL_MS : PASSWORD_RESET_TTL_MS;
  const expiresAt = new Date(now.getTime() + ttl);
  await tx.authToken.create({
    data: {
      tokenHash: hashTokenSecret(code),
      purpose: input.purpose,
      userId: input.userId,
      createdById: input.createdById ?? null,
      expiresAt,
    },
  });
  return { code, expiresAt };
}

/** A fresh invite code for a pending invitation (the previous one stops working). */
export async function issueInviteCode(
  db: PrismaClient,
  actor: Actor,
  userId: string,
): Promise<IssuedCode & { email: string; role: Role }> {
  authorize(actor, 'user.manage');
  return db.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { email: true, role: true, status: true },
    });
    if (!user) throw new AuthFlowError('User not found.');
    if (user.status !== 'INVITED') {
      throw new AuthFlowError(
        'Only a pending invitation can get a new invite code. Use a password reset link for an existing account.',
      );
    }
    const issued = await createAuthToken(tx, { userId, purpose: 'INVITE', createdById: actor.id });
    await recordAudit(tx, {
      actorId: actor.id,
      actorType: 'human',
      action: 'user.inviteCodeIssued',
      entityType: 'User',
      entityId: userId,
    });
    return { ...issued, email: user.email, role: user.role };
  });
}

/**
 * A reset code for an existing account. `actor` null means the operator's
 * recovery command on the server, audited as a system action.
 */
export async function issuePasswordResetCode(
  db: PrismaClient,
  actor: Actor | null,
  userId: string,
): Promise<IssuedCode & { email: string }> {
  if (actor) authorize(actor, 'user.manage');
  return db.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { email: true, status: true },
    });
    if (!user) throw new AuthFlowError('User not found.');
    if (user.status === 'DISABLED') {
      throw new AuthFlowError('That account is disabled. Enable it first.');
    }
    const issued = await createAuthToken(tx, {
      userId,
      purpose: 'PASSWORD_RESET',
      createdById: actor?.id ?? null,
    });
    await recordAudit(tx, {
      actorId: actor?.id ?? null,
      actorType: actor ? 'human' : 'system',
      action: 'user.passwordResetIssued',
      entityType: 'User',
      entityId: userId,
      metadata: { via: actor ? 'team_page' : 'operator' },
    });
    return { ...issued, email: user.email };
  });
}

/**
 * Self-service "forgot password". Resolves silently when the address has no
 * active account, so the response never reveals whether one exists. `deliver`
 * is the caller's sender (email); its failure propagates so it can be logged.
 */
export async function requestPasswordReset(
  db: PrismaClient,
  email: unknown,
  deliver: (to: string, issued: IssuedCode) => Promise<void>,
): Promise<void> {
  const parsed = EmailSchema.safeParse(email);
  if (!parsed.success) return;
  const user = await db.user.findUnique({
    where: { email: parsed.data },
    select: { id: true, status: true },
  });
  if (!user || user.status !== 'ACTIVE') return;
  const issued = await db.$transaction(async (tx) => {
    const token = await createAuthToken(tx, { userId: user.id, purpose: 'PASSWORD_RESET' });
    await recordAudit(tx, {
      actorId: user.id,
      actorType: 'human',
      action: 'user.passwordResetIssued',
      entityType: 'User',
      entityId: user.id,
      metadata: { via: 'self_service' },
    });
    return token;
  });
  await deliver(parsed.data, issued);
}

export const RedeemCodeSchema = z.object({
  code: z.string().trim().min(16, 'Enter the full code.'),
  password: PasswordSchema,
});

/**
 * Spend a code: set the password, activate the account, sign the person in
 * (the caller establishes the session from the returned user).
 */
export async function redeemAuthCode(
  db: PrismaClient,
  purpose: AuthTokenPurpose,
  input: unknown,
): Promise<AuthenticatedUser> {
  const { code, password } = RedeemCodeSchema.parse(input);
  const passwordHash = await hashPassword(password);
  const tokenHash = hashTokenSecret(code);
  return db.$transaction(async (tx) => {
    const now = new Date();
    // Claim atomically: two redeems of one code race on this update; one loses.
    const claimed = await tx.authToken.updateMany({
      where: { tokenHash, purpose, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (claimed.count !== 1) {
      throw new AuthFlowError(
        purpose === 'INVITE'
          ? 'That invite code is invalid, expired or already used. Ask an admin for a new one.'
          : 'That reset link is invalid, expired or already used. Request a new one.',
      );
    }
    const token = await tx.authToken.findUniqueOrThrow({
      where: { tokenHash },
      select: { userId: true },
    });
    const user = await tx.user.findUniqueOrThrow({
      where: { id: token.userId },
      select: { id: true, email: true, role: true, status: true, emailVerified: true },
    });
    if (user.status === 'DISABLED') throw new AuthFlowError('That account is disabled.');
    await tx.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        status: 'ACTIVE',
        emailVerified: user.emailVerified ?? now,
        lastLoginAt: now,
      },
    });
    await recordAudit(tx, {
      actorId: user.id,
      actorType: 'human',
      action: purpose === 'INVITE' ? 'user.invitationAccepted' : 'user.passwordChanged',
      entityType: 'User',
      entityId: user.id,
      metadata: { via: purpose === 'INVITE' ? 'invite_code' : 'reset_code' },
    });
    return { id: user.id, email: user.email, role: user.role };
  });
}

export const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password.'),
  newPassword: PasswordSchema,
});

export async function changeOwnPassword(
  db: PrismaClient,
  actor: Actor,
  input: unknown,
): Promise<void> {
  const { currentPassword, newPassword } = ChangePasswordSchema.parse(input);
  const user = await db.user.findUnique({
    where: { id: actor.id },
    select: { passwordHash: true },
  });
  if (!user || !(await verifyPassword(currentPassword, user.passwordHash))) {
    throw new AuthFlowError('Your current password is wrong.');
  }
  const passwordHash = await hashPassword(newPassword);
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: actor.id }, data: { passwordHash } });
    // Outstanding reset links are moot once the owner has set a password.
    await tx.authToken.updateMany({
      where: { userId: actor.id, purpose: 'PASSWORD_RESET', usedAt: null },
      data: { usedAt: new Date() },
    });
    await recordAudit(tx, {
      actorId: actor.id,
      actorType: 'human',
      action: 'user.passwordChanged',
      entityType: 'User',
      entityId: actor.id,
      metadata: { via: 'settings' },
    });
  });
}
