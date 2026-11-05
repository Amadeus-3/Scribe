import Link from 'next/link';
import { AuthShell } from '@/components/auth-shell';
import { ActionForm } from '@/components/action-form';
import { Field, inputClass } from '@/components/ui';
import { forgotPasswordAction } from '@/server/auth-actions';

export const metadata = { title: 'Reset password — Scribe' };

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      title="Forgot your password?"
      description="Enter your email. If this instance can send email, you will get a reset link; otherwise an admin can issue one from the Team page."
      footer={
        <Link href="/login" className="text-accent hover:underline">
          Back to sign in
        </Link>
      }
    >
      <ActionForm action={forgotPasswordAction} submitLabel="Send reset link">
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
      </ActionForm>
    </AuthShell>
  );
}
