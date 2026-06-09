import { prisma, getSettingsForActor, can } from '@scribe/core';
import { requireActor } from '@/lib/session';
import { PageHeader, Card, Field, inputClass } from '@/components/ui';
import { ActionForm } from '@/components/action-form';
import { updateSettingsAction } from '@/server/actions';

export default async function SettingsPage() {
  const actor = await requireActor();
  const settings = await getSettingsForActor(prisma, actor);
  const canEdit = can(actor.role, 'settings.update');

  const numberField = (label: string, name: string, value: number) => (
    <Field label={label} name={name}>
      <input
        id={name}
        name={name}
        type="number"
        step="any"
        defaultValue={value}
        disabled={!canEdit}
        className={inputClass}
      />
    </Field>
  );

  return (
    <>
      <PageHeader title="Settings" description="Budgets, batch sizes, and model selection." />
      {!canEdit ? <p className="mb-3 text-sm text-muted">Read-only — Admin can edit.</p> : null}
      <div className="max-w-2xl">
        <Card title="Budget & pipeline">
          <ActionForm action={updateSettingsAction} submitLabel="Save settings">
            <div className="grid grid-cols-2 gap-3">
              {numberField('Monthly budget (USD)', 'monthly_budget_usd', settings.monthly_budget_usd)}
              {numberField(
                'Per-article ceiling (USD)',
                'per_article_cost_ceiling_usd',
                settings.per_article_cost_ceiling_usd,
              )}
              {numberField('Keyword buffer target', 'keyword_buffer_target', settings.keyword_buffer_target)}
              {numberField('Briefs per run', 'briefs_per_run', settings.briefs_per_run)}
              {numberField('Max regen attempts', 'max_regen', settings.max_regen)}
            </div>
            <div className="mt-1 grid grid-cols-3 gap-3">
              <Field label="Brief model" name="models.brief">
                <input
                  id="models.brief"
                  name="models.brief"
                  defaultValue={settings.models.brief}
                  disabled={!canEdit}
                  className={inputClass}
                />
              </Field>
              <Field label="Draft model" name="models.draft">
                <input
                  id="models.draft"
                  name="models.draft"
                  defaultValue={settings.models.draft}
                  disabled={!canEdit}
                  className={inputClass}
                />
              </Field>
              <Field label="QA model" name="models.qa">
                <input
                  id="models.qa"
                  name="models.qa"
                  defaultValue={settings.models.qa}
                  disabled={!canEdit}
                  className={inputClass}
                />
              </Field>
            </div>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
