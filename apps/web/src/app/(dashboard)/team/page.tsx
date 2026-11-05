import { prisma, listTeam, can, type TeamMember } from '@scribe/core';
import { requireActor } from '@/lib/session';
import { PageHeader, Card, Field, Badge, EmptyState, inputClass } from '@/components/ui';
import { ActionForm } from '@/components/action-form';
import { InlineActionForm } from '@/components/inline-action-form';
import {
  deleteInvitationAction,
  inviteUserAction,
  issuePasswordResetAction,
  reissueInviteCodeAction,
  setUserStatusAction,
  updateUserRoleAction,
} from '@/server/actions';

export const metadata = { title: 'Team — Scribe' };

const ROLES = ['ADMIN', 'EDITOR', 'VIEWER'] as const;

function statusTone(status: TeamMember['status']): 'ok' | 'warn' | 'danger' {
  if (status === 'ACTIVE') return 'ok';
  if (status === 'INVITED') return 'warn';
  return 'danger';
}

function fmt(date: Date | null): string {
  return date ? date.toISOString().replace('T', ' ').slice(0, 16) : '—';
}

export default async function TeamPage() {
  const actor = await requireActor();
  // The service refuses non-admins anyway; this only chooses the friendlier page.
  if (!can(actor.role, 'user.manage')) {
    return (
      <>
        <PageHeader title="Team" />
        <EmptyState
          title="Admins only"
          description="Only an ADMIN can view accounts, invite people or change roles."
        />
      </>
    );
  }
  const team = await listTeam(prisma, actor);

  return (
    <>
      <PageHeader
        title="Team"
        description="Who can sign in and what they may do. Access is by invitation: nobody can sign up on their own. ADMIN manages everything, EDITOR reviews and approves articles, VIEWER reads. A reset link lets someone who forgot their password choose a new one."
      />
      <div className="grid gap-6">
        <Card
          title="Invite someone"
          description="Creates the account and an invite link. If email delivery is configured the link is emailed; either way it is shown here so you can send it yourself. The account becomes active when they open it and choose a password."
        >
          <ActionForm action={inviteUserAction} submitLabel="Create invitation">
            <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
              <Field label="Email" name="email">
                <input
                  id="email"
                  name="email"
                  type="email"
                  required
                  placeholder="colleague@example.com"
                  className={inputClass}
                />
              </Field>
              <Field label="Role" name="role">
                <select id="role" name="role" defaultValue="EDITOR" className={inputClass}>
                  {ROLES.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </ActionForm>
        </Card>

        <Card
          title="Accounts"
          description={`${team.length} account${team.length === 1 ? '' : 's'}`}
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted">
                  <th className="pb-2 font-medium">Email</th>
                  <th className="pb-2 font-medium">Status</th>
                  <th className="pb-2 font-medium">Role</th>
                  <th className="pb-2 font-medium">Last sign-in</th>
                  <th className="pb-2 font-medium">Invited by</th>
                  <th className="pb-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {team.map((member) => {
                  const isSelf = member.id === actor.id;
                  return (
                    <tr key={member.id} className="border-b border-border/60 align-top">
                      <td className="py-3 pr-3">
                        <div className="font-medium text-fg">{member.email}</div>
                        {isSelf ? <div className="text-xs text-muted">you</div> : null}
                      </td>
                      <td className="py-3 pr-3">
                        <Badge tone={statusTone(member.status)}>{member.status}</Badge>
                      </td>
                      <td className="py-3 pr-3">
                        <InlineActionForm action={updateUserRoleAction} submitLabel="Save">
                          <input type="hidden" name="userId" value={member.id} />
                          <select
                            name="role"
                            defaultValue={member.role}
                            aria-label={`Role for ${member.email}`}
                            className={`${inputClass} h-8 w-32 py-0 text-xs`}
                          >
                            {ROLES.map((role) => (
                              <option key={role} value={role}>
                                {role}
                              </option>
                            ))}
                          </select>
                        </InlineActionForm>
                      </td>
                      <td className="py-3 pr-3 text-muted">{fmt(member.lastLoginAt)}</td>
                      <td className="py-3 pr-3 text-muted">
                        {member.invitedByEmail ?? (member.invitedAt ? '—' : 'bootstrap')}
                      </td>
                      <td className="py-3">
                        <div className="flex flex-wrap gap-2">
                          {member.status === 'INVITED' ? (
                            <>
                              <InlineActionForm
                                action={reissueInviteCodeAction}
                                submitLabel="New invite link"
                              >
                                <input type="hidden" name="userId" value={member.id} />
                              </InlineActionForm>
                              <InlineActionForm
                                action={deleteInvitationAction}
                                submitLabel="Delete invitation"
                                submitVariant="danger"
                              >
                                <input type="hidden" name="userId" value={member.id} />
                              </InlineActionForm>
                            </>
                          ) : null}
                          {member.status === 'ACTIVE' ? (
                            <InlineActionForm
                              action={issuePasswordResetAction}
                              submitLabel="Reset link"
                            >
                              <input type="hidden" name="userId" value={member.id} />
                            </InlineActionForm>
                          ) : null}
                          {member.status === 'ACTIVE' && !isSelf ? (
                            <InlineActionForm
                              action={setUserStatusAction}
                              submitLabel="Disable"
                              submitVariant="danger"
                            >
                              <input type="hidden" name="userId" value={member.id} />
                              <input type="hidden" name="status" value="DISABLED" />
                            </InlineActionForm>
                          ) : null}
                          {member.status === 'DISABLED' ? (
                            <InlineActionForm action={setUserStatusAction} submitLabel="Enable">
                              <input type="hidden" name="userId" value={member.id} />
                              <input type="hidden" name="status" value="ACTIVE" />
                            </InlineActionForm>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}
