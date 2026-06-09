export const metadata = { title: 'Check your email — Scribe' };

export default function VerifyRequestPage() {
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
      <div style={{ width: 360, maxWidth: '90vw', textAlign: 'center' }}>
        <h1 style={{ fontSize: '1.25rem' }}>Check your email</h1>
        <p style={{ color: '#9a9aa2', fontSize: '0.9rem' }}>
          A sign-in link has been sent. In local development, open Mailpit at{' '}
          <a href="http://localhost:8025" style={{ color: '#818cf8' }}>
            localhost:8025
          </a>{' '}
          to find it.
        </p>
      </div>
    </main>
  );
}
