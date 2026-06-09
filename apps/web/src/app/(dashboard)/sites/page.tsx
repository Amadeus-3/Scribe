import Link from 'next/link';
import { prisma, listSites, can } from '@scribe/core';
import { requireActor } from '@/lib/session';
import { PageHeader, Card, Field, Badge, inputClass } from '@/components/ui';
import { ActionForm } from '@/components/action-form';
import { createSiteAction } from '@/server/actions';

export default async function SitesPage() {
  const actor = await requireActor();
  const sites = await listSites(prisma, actor);
  const canCreate = can(actor.role, 'site.create');

  return (
    <>
      <PageHeader title="Sites" description="Blogs connected to Scribe." />
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <Card>
          {sites.length === 0 ? (
            <p className="text-sm text-muted">No sites yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="pb-2 font-medium">Name</th>
                  <th className="pb-2 font-medium">URL</th>
                  <th className="pb-2 font-medium">Status</th>
                  <th className="pb-2 font-medium">Credentials</th>
                </tr>
              </thead>
              <tbody>
                {sites.map((s) => (
                  <tr key={s.id} className="border-t border-border">
                    <td className="py-2">
                      <Link href={`/sites/${s.id}`} className="text-accent hover:underline">
                        {s.name}
                      </Link>
                    </td>
                    <td className="text-muted">{s.baseUrl}</td>
                    <td>
                      <Badge tone={s.status === 'ACTIVE' ? 'ok' : 'muted'}>{s.status}</Badge>
                    </td>
                    <td>
                      {s.hasCredentials ? (
                        <Badge tone="ok">set</Badge>
                      ) : (
                        <Badge tone="muted">none</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        {canCreate ? (
          <Card title="Add a site">
            <ActionForm action={createSiteAction} submitLabel="Create site">
              <Field label="Name" name="name">
                <input id="name" name="name" required className={inputClass} />
              </Field>
              <Field label="Base URL" name="baseUrl">
                <input
                  id="baseUrl"
                  name="baseUrl"
                  type="url"
                  required
                  placeholder="https://blog.example.com"
                  className={inputClass}
                />
              </Field>
              <Field label="Default author" name="defaultAuthor" hint="Optional CMS author">
                <input id="defaultAuthor" name="defaultAuthor" className={inputClass} />
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="briefAutoApprove" defaultChecked /> Auto-approve briefs
              </label>
            </ActionForm>
          </Card>
        ) : null}
      </div>
    </>
  );
}
