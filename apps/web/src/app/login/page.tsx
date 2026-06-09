import { signIn } from '@/auth';

export const metadata = { title: 'Sign in — Scribe' };

export default function LoginPage() {
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
        <h1 style={{ fontSize: '1.25rem', margin: 0 }}>Scribe</h1>
        <p style={{ color: '#9a9aa2', margin: 0, fontSize: '0.9rem' }}>
          Sign in with a magic link. Only allowlisted emails are accepted.
        </p>
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
