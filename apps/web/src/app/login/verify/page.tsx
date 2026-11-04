import { countUsers, prisma, resolveEmailConfig } from '@scribe/core';

export const metadata = { title: 'Check your email — Scribe' };

// Reads live config and the user count, so it must not be prerendered.
export const dynamic = 'force-dynamic';

export default async function VerifyRequestPage() {
  const [emailConfigured, userCount] = await Promise.all([
    resolveEmailConfig(prisma).then((c) => c !== null),
    countUsers(prisma),
  ]);
  // Mirrors the bootstrap rule in auth.ts: no SMTP and no users means the link
  // went to the server log instead of an inbox.
  const loggedInstead = !emailConfigured && userCount === 0;
  const isDev = process.env.NODE_ENV !== 'production';

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
      <div style={{ width: 420, maxWidth: '90vw', textAlign: 'center' }}>
        {loggedInstead ? (
          <>
            <h1 style={{ fontSize: '1.25rem' }}>Check the server logs</h1>
            <p style={{ color: '#9a9aa2', fontSize: '0.9rem' }}>
              Email delivery is not configured yet, so the sign-in link for the first admin was
              printed to the web server log instead. Find it with:
            </p>
            <pre
              style={{
                textAlign: 'left',
                padding: '0.6rem 0.7rem',
                borderRadius: 6,
                background: '#141417',
                border: '1px solid #2a2a2e',
                fontSize: '0.8rem',
                overflowX: 'auto',
              }}
            >
              docker compose logs web | grep signInUrl
            </pre>
            <p style={{ color: '#9a9aa2', fontSize: '0.9rem' }}>
              After signing in, set SMTP under Settings &gt; Email so invitations and future links
              arrive by email.
            </p>
          </>
        ) : (
          <>
            <h1 style={{ fontSize: '1.25rem' }}>Check your email</h1>
            <p style={{ color: '#9a9aa2', fontSize: '0.9rem' }}>
              A sign-in link has been sent.
              {isDev ? (
                <>
                  {' '}
                  In local development, open Mailpit at{' '}
                  <a href="http://localhost:8026" style={{ color: '#818cf8' }}>
                    localhost:8026
                  </a>{' '}
                  to find it.
                </>
              ) : null}
            </p>
          </>
        )}
      </div>
    </main>
  );
}
