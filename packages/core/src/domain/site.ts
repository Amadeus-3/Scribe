import { z } from 'zod';

/**
 * Per-site CMS credentials. Stored ONLY as AES-256-GCM ciphertext in
 * Site.cmsCredentialsEnc (Spec §10.3). Secret-bearing fields are never returned
 * to the client; non-secret CMS routing and field mapping can be shown to Admins
 * so they can maintain the integration.
 */
export const CmsTypeSchema = z.enum(['WORDPRESS', 'STRAPI']);
export type CmsTypeInput = z.infer<typeof CmsTypeSchema>;

export const WordPressCredentialsSchema = z.object({
  cmsType: z.literal('WORDPRESS'),
  username: z.string().min(1),
  applicationPassword: z.string().min(1),
});
export type WordPressCredentials = z.infer<typeof WordPressCredentialsSchema>;

export const LegacyWordPressCredentialsSchema = z
  .object({
    username: z.string().min(1),
    applicationPassword: z.string().min(1),
  })
  .transform((value): WordPressCredentials => ({ cmsType: 'WORDPRESS', ...value }));

export const StrapiContentFormatSchema = z.enum(['HTML', 'MARKDOWN', 'STRAPI_BLOCKS']);
export const StrapiPublicationStatusSchema = z.enum(['DRAFT', 'PUBLISHED']);

export const StrapiCredentialsSchema = z.object({
  cmsType: z.literal('STRAPI'),
  apiToken: z.string().min(1),
  apiBaseUrl: z.string().url('Strapi API URL must be a valid URL').optional(),
  collectionApiId: z
    .string()
    .min(1)
    .regex(/^[a-zA-Z0-9_-]+$/, 'Collection API ID should not include /api/ or slashes')
    .default('articles'),
  // Plural API IDs of the taxonomy collections used to resolve relations by slug.
  categoryApiId: z
    .string()
    .min(1)
    .regex(/^[a-zA-Z0-9_-]+$/, 'Category API ID should not include /api/ or slashes')
    .default('categories'),
  tagApiId: z
    .string()
    .min(1)
    .regex(/^[a-zA-Z0-9_-]+$/, 'Tag API ID should not include /api/ or slashes')
    .default('tags'),
  fieldMap: z
    .object({
      title: z.string().min(1).default('title'),
      slug: z.string().min(1).default('slug'),
      content: z.string().min(1).default('content'),
      metaDescription: z.string().optional(),
      image: z.string().optional(),
      readTime: z.string().optional(),
      author: z.string().optional(),
      date: z.string().optional(),
      featured: z.string().optional(),
      // Article relation attributes for the chosen category / tags.
      category: z.string().min(1).default('category'),
      tags: z.string().min(1).default('tags'),
    })
    .default({
      title: 'title',
      slug: 'slug',
      content: 'content',
      metaDescription: 'description',
      image: 'image',
      readTime: 'readTime',
      author: 'author',
      date: 'date',
      featured: 'featured',
      category: 'category',
      tags: 'tags',
    }),
  contentFormat: StrapiContentFormatSchema.default('HTML'),
  publicationStatus: StrapiPublicationStatusSchema.default('PUBLISHED'),
  locale: z.string().min(1).optional(),
});
export type StrapiCredentials = z.infer<typeof StrapiCredentialsSchema>;

export const CmsCredentialsSchema = z.discriminatedUnion('cmsType', [
  WordPressCredentialsSchema,
  StrapiCredentialsSchema,
]);
export type CmsCredentials = z.infer<typeof CmsCredentialsSchema>;

export type SiteCredentialsSummary =
  | {
      cmsType: 'WORDPRESS';
      username: string | null;
      hasSecret: boolean;
    }
  | {
      cmsType: 'STRAPI';
      apiBaseUrl: string | null;
      collectionApiId: string;
      fieldMap: StrapiCredentials['fieldMap'];
      contentFormat: StrapiCredentials['contentFormat'];
      publicationStatus: StrapiCredentials['publicationStatus'];
      locale: string | null;
      hasSecret: boolean;
    };

export const SiteInputSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  baseUrl: z.string().url('Must be a valid URL'),
  // Public URL path prefix for posts, e.g. "/blog" → {baseUrl}/blog/{slug}.
  // Empty/omitted = posts live at the site root. Drives correct internal links.
  articlePathPrefix: z
    .string()
    .trim()
    .optional()
    .refine((v) => !v || /^\/?[a-z0-9\-_/]*$/i.test(v), {
      message: 'Use a URL path like /blog',
    }),
  cmsType: CmsTypeSchema.default('WORDPRESS'),
  defaultAuthor: z.string().optional(),
  briefAutoApprove: z.boolean().default(true),
  // Google Search Console property id, e.g. "https://example.com/" or "sc-domain:example.com".
  gscPropertyUrl: z
    .string()
    .trim()
    .optional()
    .refine((v) => !v || /^(https?:\/\/.+|sc-domain:.+)$/.test(v), {
      message: 'Use an https URL or sc-domain:example.com',
    }),
  // Opt this site into the weekly trending-topic discovery cron.
  discoveryEnabled: z.boolean().default(false),
  // Opt this site into autopilot drafting (the global switch is also required).
  autopilotEnabled: z.boolean().default(false),
  // Per-site weekly target; null inherits the global setting.
  autopilotArticlesPerWeek: z.number().int().nonnegative().max(100).nullable().default(null),
});
export type SiteInput = z.infer<typeof SiteInputSchema>;

/** Credentials are optional on update (omit = leave the existing ones intact). */
export const SiteCredentialsInputSchema = CmsCredentialsSchema.optional();
