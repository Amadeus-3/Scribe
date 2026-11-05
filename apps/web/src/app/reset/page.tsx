import Link from 'next/link';
import { PASSWORD_MIN_LENGTH } from '@scribe/core';
import { AuthShell } from '@/components/auth-shell';
import { ActionForm } from '@/components/action-form';
import { Field, inputClass } from '@/components/ui';
import { resetPasswordAction } from '@/server/auth-actions';

export const metadata = { title: 'Set a new password — Scribe' };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const code = typeof params.code === 'string' ? params.code : '';

  return (
    <AuthShell
      title="Set a new password"
      description="Use the code from your reset link. It works once and expires after an hour."
      footer={
        <Link href="/login" className="text-accent hover:underline">
          Back to sign in
        </Link>
      }
    >
      <ActionForm action={resetPasswordAction} submitLabel="Save password and sign in">
        <Field label="Reset code" name="code">
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
          label="New password"
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
