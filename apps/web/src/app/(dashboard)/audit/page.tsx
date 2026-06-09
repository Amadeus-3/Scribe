import { prisma } from '@scribe/core';
import { requireCan } from '@/lib/session';
import { PageHeader, Card } from '@/components/ui';

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
      <Card>
        {logs.length === 0 ? (
          <p className="text-sm text-muted">No audit entries yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="pb-2 font-medium">When</th>
                <th className="pb-2 font-medium">Actor</th>
                <th className="pb-2 font-medium">Action</th>
                <th className="pb-2 font-medium">Entity</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id} className="border-t border-border">
                  <td className="py-1.5 text-muted tabular-nums">
                    {log.createdAt.toISOString().replace('T', ' ').slice(0, 19)}
                  </td>
                  <td className="text-muted">
                    {log.actor?.email ?? (log.actorType === 'system' ? 'system' : '—')}
                  </td>
                  <td className="font-medium">{log.action}</td>
                  <td className="text-muted">
                    {log.entityType}:{log.entityId.slice(0, 8)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
