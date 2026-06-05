'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

// Reports React render errors in the App Router to Sentry (Spec §11).
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <main style={{ fontFamily: 'system-ui, sans-serif', padding: '3rem' }}>
          <h2>Something went wrong.</h2>
        </main>
      </body>
    </html>
  );
}
