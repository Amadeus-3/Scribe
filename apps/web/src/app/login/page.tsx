import { signIn } from '@/auth';
import { countUsers, prisma } from '@scribe/core';

export const metadata = { title: 'Sign in — Scribe' };

// Reads the user count, so it cannot be prerendered at build time.
export const dynamic = 'force-dynamic';

// Auth.js redirects here with ?error=... (pages.error). Keep the copy generic:
// it must not reveal whether an address exists.
const ERROR_COPY: Record<string, string> = {
  AccessDenied: 'That email is not invited. Ask an admin to add you from the Team page.',
  EmailSignin:
    'The sign-in email could not be sent. Email delivery is not configured or failed; an admin can fix it under Settings > Email.',
  Verification: 'That link has expired or was already used. Request a new one.',
  Configuration: 'The server is misconfigured. Check the web container logs.',
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // A fresh instance explains itself: the first email in becomes the admin.
  const isFreshInstance = (await countUsers(prisma)) === 0;
  const params = await searchParams;
  const errorKey = typeof params.error === 'string' ? params.error : undefined;
  const errorText = errorKey ? (ERROR_COPY[errorKey] ?? 'Sign-in failed. Please try again.') : null;

  async function sendMagicLink(formData: FormData) {
    'use server';
    const email = String(formData.get('email') ?? '').trim();
    if (!email) return;
    await signIn('nodemailer', { email, redirectTo: '/' });
  }

  return (
    <main
      style={{
        minHeight: '100dvh',
        display: 'grid',
        placeItems: 'center',
        fontFamily: 'system-ui, sans-serif',
        background: '#0b0b0c',
        color: '#e7e7ea',
      }}
    >
      <form
        action={sendMagicLink}
        style={{ width: 360, maxWidth: '90vw', display: 'grid', gap: 12 }}
      >
        <h1 style={{ fontSize: '1.25rem', margin: 0 }}>
          {isFreshInstance ? 'Create the first admin account' : 'Scribe'}
        </h1>
        <p style={{ color: '#9a9aa2', margin: 0, fontSize: '0.9rem' }}>
          {isFreshInstance
            ? 'This instance has no accounts yet. The first email to sign in becomes the administrator and can invite the rest of the team.'
            : 'Sign in with a magic link. Access is by invitation; ask an admin if you need an account.'}
        </p>
        {errorText ? (
          <p
            role="alert"
            style={{
              margin: 0,
              padding: '0.6rem 0.7rem',
              borderRadius: 6,
              border: '1px solid #7f1d1d',
              background: '#2a1215',
              color: '#fca5a5',
              fontSize: '0.85rem',
            }}
          >
            {errorText}
          </p>
        ) : null}
        <input
          name="email"
          type="email"
          required
          placeholder="you@example.com"
          aria-label="Email address"
          style={{
            padding: '0.6rem 0.7rem',
            borderRadius: 6,
            border: '1px solid #2a2a2e',
            background: '#141417',
            color: 'inherit',
          }}
        />
        <button
          type="submit"
          style={{
            padding: '0.6rem 0.7rem',
            borderRadius: 6,
            border: 0,
            background: '#4f46e5',
            color: '#fff',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Send magic link
        </button>
      </form>
    </main>
  );
}
