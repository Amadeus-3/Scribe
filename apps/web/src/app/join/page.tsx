import Link from 'next/link';
import { redirect } from 'next/navigation';
import { prisma, needsSetup, PASSWORD_MIN_LENGTH } from '@scribe/core';
import { AuthShell } from '@/components/auth-shell';
import { ActionForm } from '@/components/action-form';
import { Field, inputClass } from '@/components/ui';
import { joinAction } from '@/server/auth-actions';

export const metadata = { title: 'Join Scribe' };
export const dynamic = 'force-dynamic';

export default async function JoinPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (await needsSetup(prisma)) redirect('/setup');
  const params = await searchParams;
  const code = typeof params.code === 'string' ? params.code : '';

  return (
    <AuthShell
      title="Join your team"
      description="An admin gave you an invite code or link. Choose a password to activate your account."
      footer={
        <Link href="/login" className="text-accent hover:underline">
          Already have an account? Sign in
        </Link>
      }
    >
      <ActionForm action={joinAction} submitLabel="Activate and sign in">
        <Field label="Invite code" name="code">
          <input
            id="code"
            name="code"
            type="text"
            required
            defaultValue={code}
            autoComplete="off"
            spellCheck={false}
            className={inputClass}
          />
        </Field>
        <Field
          label="Password"
          name="password"
          hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
        >
          <input
            id="password"
            name="password"
            type="password"
            required
            minLength={PASSWORD_MIN_LENGTH}
            autoComplete="new-password"
            className={inputClass}
          />
        </Field>
        <Field label="Confirm password" name="confirmPassword">
          <input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            required
            autoComplete="new-password"
            className={inputClass}
          />
        </Field>
      </ActionForm>
    </AuthShell>
  );
}
