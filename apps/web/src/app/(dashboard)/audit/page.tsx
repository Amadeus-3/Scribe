import { prisma } from '@scribe/core';
import { requireCan } from '@/lib/session';
import { Card, EmptyState, PageHeader } from '@/components/ui';

export default async function AuditPage() {
  await requireCan('auditLog.read');
  const logs = await prisma.auditLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: { actor: { select: { email: true } } },
  });

  return (
    <>
      <PageHeader title="Audit log" description="Every state-changing action, most recent first." />
      <Card title="Recent activity" description="The last 100 state-changing actions.">
        {logs.length === 0 ? (
          <EmptyState title="No audit entries yet" description="Activity appears here after a site, setting, article, or publish action changes state." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted">
                  <th className="pb-2 font-medium">When</th>
                  <th className="pb-2 font-medium">Actor</th>
                  <th className="pb-2 font-medium">Action</th>
                  <th className="pb-2 font-medium">Entity</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id} className="border-b border-border last:border-0">
                    <td className="py-3 text-muted tabular-nums">
                      {log.createdAt.toISOString().replace('T', ' ').slice(0, 19)}
                    </td>
                    <td className="max-w-[240px] truncate text-muted">
                      {log.actor?.email ?? (log.actorType === 'system' ? 'system' : 'unknown')}
                    </td>
                    <td className="font-medium">{log.action}</td>
                    <td className="text-muted">
                      {log.entityType}:{log.entityId.slice(0, 8)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
