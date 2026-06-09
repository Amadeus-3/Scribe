import { z } from 'zod';

/**
 * Per-site CMS credentials. Stored ONLY as AES-256-GCM ciphertext in
 * Site.cmsCredentialsEnc (Spec §10.3) — never in plaintext, never returned to
 * the client. WordPress uses an Application Password on a least-privilege
 * Author/Editor account (Spec §6.7, §10.3), never the admin password.
 */
export const WordPressCredentialsSchema = z.object({
  username: z.string().min(1),
  applicationPassword: z.string().min(1),
});
export type WordPressCredentials = z.infer<typeof WordPressCredentialsSchema>;

export const SiteInputSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  baseUrl: z.string().url('Must be a valid URL'),
  defaultAuthor: z.string().optional(),
  briefAutoApprove: z.boolean().default(true),
});
export type SiteInput = z.infer<typeof SiteInputSchema>;

/** Credentials are optional on update (omit = leave the existing ones intact). */
export const SiteCredentialsInputSchema = WordPressCredentialsSchema.optional();
