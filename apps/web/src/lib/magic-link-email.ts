/**
 * Plain magic-link email. Auth.js ships templates but does not export their
 * types, so this keeps ours small and dependency-free. `host` and `url` come
 * from Auth.js, never from user input.
 */
export function magicLinkText({ url, host }: { url: string; host: string }): string {
  return `Sign in to ${host}\n${url}\n\nIf you did not request this email, you can ignore it.\n`;
}

export function magicLinkHtml({ url, host }: { url: string; host: string }): string {
  const safeHost = host.replace(/[<>&"']/g, '');
  return `<!doctype html>
<body style="margin:0;padding:24px;background:#f4f4f5;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#18181b">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:480px;background:#ffffff;border-radius:8px;padding:24px">
        <tr><td style="font-size:18px;font-weight:600;padding-bottom:12px">Sign in to ${safeHost}</td></tr>
        <tr><td style="font-size:14px;line-height:22px;padding-bottom:20px">Click the button to sign in. This link can be used once and expires in 24 hours.</td></tr>
        <tr><td align="center" style="padding-bottom:20px">
          <a href="${url}" style="display:inline-block;padding:10px 18px;border-radius:6px;background:#4f46e5;color:#ffffff;font-weight:600;text-decoration:none">Sign in</a>
        </td></tr>
        <tr><td style="font-size:12px;line-height:18px;color:#71717a">If you did not request this email, you can safely ignore it.</td></tr>
      </table>
    </td></tr>
  </table>
</body>`;
}
