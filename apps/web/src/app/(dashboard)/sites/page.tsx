import Link from 'next/link';
import { prisma, listSites, can } from '@scribe/core';
import { requireActor } from '@/lib/session';
import {
  Badge,
  Card,
  EmptyState,
  Field,
  PageHeader,
  StatusBadge,
  StepList,
  buttonClass,
  inputClass,
} from '@/components/ui';
import { ActionForm } from '@/components/action-form';
import { createSiteAction } from '@/server/actions';

export default async function SitesPage() {
  const actor = await requireActor();
  const sites = await listSites(prisma, actor);
  const canCreate = can(actor.role, 'site.create');

  return (
    <>
      <PageHeader
        title="Sites"
        description="Configure each blog once, then generate and publish articles from its site page."
      />
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <Card title="Connected blogs" description="Open a site to edit its style guide, CMS mapping, keywords, and drafts.">
          {sites.length === 0 ? (
            <EmptyState
              title="No sites connected"
              description="Add the blog URL and CMS type first. Credentials and field mapping are configured on the next screen."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted">
                    <th className="pb-2 font-medium">Site</th>
                    <th className="pb-2 font-medium">CMS</th>
                    <th className="pb-2 font-medium">State</th>
                    <th className="pb-2 font-medium">Credentials</th>
                    <th className="pb-2 font-medium">Created</th>
                    <th className="pb-2 text-right font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {sites.map((s) => (
                    <tr key={s.id} className="border-b border-border last:border-0">
                      <td className="max-w-[260px] py-3">
                        <Link href={`/sites/${s.id}`} className="block truncate font-medium text-fg hover:text-accent">
                          {s.name}
                        </Link>
                        <div className="mt-0.5 truncate text-xs text-muted">{s.baseUrl}</div>
                      </td>
                      <td>
                        <Badge tone="muted">{s.cmsType}</Badge>
                      </td>
                      <td>
                        <StatusBadge status={s.status} />
                      </td>
                      <td>
                        {s.hasCredentials ? (
                          <Badge tone="ok">configured</Badge>
                        ) : (
                          <Badge tone="warn">missing</Badge>
                        )}
                      </td>
                      <td className="text-xs text-muted">{s.createdAt.toISOString().slice(0, 10)}</td>
                      <td className="text-right">
                        <Link href={`/sites/${s.id}`} className={buttonClass({ variant: 'secondary', size: 'sm' })}>
                          Open
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="grid content-start gap-4">
          <Card title="Site workflow">
            <StepList
              steps={[
                { label: 'Add blog', description: 'Name, public URL, CMS type.', done: sites.length > 0 },
                { label: 'Connect CMS', description: 'Save the Strapi token and article fields.' },
                { label: 'Save style guide', description: 'Let AI suggest context, then edit it.' },
                { label: 'Generate draft', description: 'Pick a keyword and review the result.' },
              ]}
            />
          </Card>

          {canCreate ? (
            <Card
              title="Add a site"
              description="Just the basics here. You'll connect CMS credentials, write the style guide, and add keywords on the site's page next."
            >
              <ActionForm action={createSiteAction} submitLabel="Create site">
                <Field label="Name" name="name">
                  <input id="name" name="name" required className={inputClass} />
                </Field>
                <Field label="Public website URL" name="baseUrl">
                  <input
                    id="baseUrl"
                    name="baseUrl"
                    type="url"
                    required
                    placeholder="https://blog.example.com"
                    className={inputClass}
                  />
                </Field>
                <Field label="Article CMS" name="cmsType">
                  <select id="cmsType" name="cmsType" defaultValue="STRAPI" className={inputClass}>
                    <option value="STRAPI">Strapi</option>
                    <option value="WORDPRESS">WordPress</option>
                  </select>
                </Field>
                <Field label="Default author" name="defaultAuthor" hint="Optional CMS author">
                  <input id="defaultAuthor" name="defaultAuthor" className={inputClass} />
                </Field>
                <label className="flex items-center gap-2 rounded-md border border-border bg-panel-2 px-3 py-2 text-sm">
                  <input type="checkbox" name="briefAutoApprove" defaultChecked /> Auto-approve briefs
                </label>
              </ActionForm>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
