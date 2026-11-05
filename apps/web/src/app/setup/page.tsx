import { notFound } from 'next/navigation';
import { prisma, needsSetup, getEnv, PASSWORD_MIN_LENGTH } from '@scribe/core';
import { AuthShell } from '@/components/auth-shell';
import { ActionForm } from '@/components/action-form';
import { Field, inputClass } from '@/components/ui';
import { setupAction } from '@/server/auth-actions';

export const metadata = { title: 'Set up Scribe' };
export const dynamic = 'force-dynamic';

/**
 * First-run page. Exists only while the instance has zero accounts; the
 * server action re-checks that inside a locked transaction, so this page
 * disappearing is convenience, not the guard.
 */
export default async function SetupPage() {
  if (!(await needsSetup(prisma))) notFound();
  const tokenRequired = Boolean(getEnv().SETUP_TOKEN);

  return (
    <AuthShell
      title="Create the administrator account"
      description="This Scribe instance has no accounts yet. The account you create here is the administrator; it can invite everyone else from the Team page."
      footer="Finish this now: until an administrator exists, anyone who can reach this address could claim it."
    >
      <ActionForm action={setupAction} submitLabel="Create account and sign in">
        <Field label="Your name" name="name" hint="Optional. Shown to your team.">
          <input id="name" name="name" type="text" autoComplete="name" className={inputClass} />
        </Field>
        <Field label="Email" name="email" hint="You sign in with this address.">
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
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
        {tokenRequired ? (
          <Field
            label="Setup token"
            name="setupToken"
            hint="This server requires the SETUP_TOKEN from its environment file."
          >
            <input
              id="setupToken"
              name="setupToken"
              type="password"
              required
              autoComplete="off"
              className={inputClass}
            />
          </Field>
        ) : null}
      </ActionForm>
    </AuthShell>
  );
}
