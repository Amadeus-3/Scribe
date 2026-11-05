import Link from 'next/link';
import { redirect } from 'next/navigation';
import { prisma, needsSetup } from '@scribe/core';
import { AuthShell } from '@/components/auth-shell';
import { ActionForm } from '@/components/action-form';
import { Field, inputClass } from '@/components/ui';
import { loginAction } from '@/server/auth-actions';
import { safeRedirectPath } from '@/lib/app-url';

export const metadata = { title: 'Sign in — Scribe' };

// Reads the user count, so it cannot be prerendered at build time.
export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // An empty instance has nobody to sign in; it needs its first admin.
  if (await needsSetup(prisma)) redirect('/setup');
  const params = await searchParams;
  const callbackUrl = safeRedirectPath(params.callbackUrl);
  // Auth.js lands here with ?error= when a session is rejected mid-flight.
  const authError = typeof params.error === 'string';

  return (
    <AuthShell
      title="Sign in"
      description="Access is by invitation. Ask an admin if you need an account."
      footer={
        <>
          <Link href="/forgot" className="text-accent hover:underline">
            Forgot your password?
          </Link>
          <span className="mx-2">·</span>
          <Link href="/join" className="text-accent hover:underline">
            Have an invite code?
          </Link>
        </>
      }
    >
      {authError ? (
        <p
          role="alert"
          className="mb-3 rounded-md border border-danger/30 bg-danger/10 px-2.5 py-1.5 text-xs text-danger"
        >
          Your session ended. Sign in again.
        </p>
      ) : null}
      <ActionForm action={loginAction} submitLabel="Sign in">
        <input type="hidden" name="callbackUrl" value={callbackUrl} />
        <Field label="Email" name="email">
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            className={inputClass}
          />
        </Field>
        <Field label="Password" name="password">
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className={inputClass}
          />
        </Field>
      </ActionForm>
    </AuthShell>
  );
}
