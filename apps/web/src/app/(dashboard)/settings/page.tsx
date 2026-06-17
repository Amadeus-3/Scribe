import {
  prisma,
  getGeminiCredentialSummary,
  getGscCredentialSummary,
  getOpenRouterCredentialSummary,
  getSettingsForActor,
  can,
} from '@scribe/core';
import { requireActor } from '@/lib/session';
import { PageHeader, Card, Field, Badge, inputClass } from '@/components/ui';
import { ActionForm } from '@/components/action-form';
import {
  updateSettingsAction,
  setGeminiApiKeyAction,
  setOpenRouterApiKeyAction,
  setGscServiceAccountAction,
  syncOpenRouterModelsAction,
} from '@/server/actions';

const GEMINI_IMAGE_MODELS = [
  { id: 'gemini-3.1-flash-image', name: 'Gemini 3.1 Flash Image' },
  { id: 'gemini-3-pro-image', name: 'Gemini 3 Pro Image' },
  { id: 'gemini-2.5-flash-image', name: 'Gemini 2.5 Flash Image' },
];

export default async function SettingsPage() {
  const actor = await requireActor();
  const settings = await getSettingsForActor(prisma, actor);
  const openRouterCredential = await getOpenRouterCredentialSummary(prisma, actor);
  const geminiCredential = await getGeminiCredentialSummary(prisma, actor);
  const gscCredential = await getGscCredentialSummary(prisma, actor);
  const canEdit = can(actor.role, 'settings.update');
  const modelCatalog = settings.openrouter.modelCatalog;
  const catalogSyncedAt = settings.openrouter.modelCatalogSyncedAt
    ? settings.openrouter.modelCatalogSyncedAt.replace('T', ' ').slice(0, 19)
    : 'Never';

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

  const textModelField = (label: string, name: string, value: string) => {
    const currentInCatalog = modelCatalog.some((model) => model.id === value);
    return (
      <Field
        label={label}
        name={name}
        hint={modelCatalog.length > 0 ? 'Synced OpenRouter models' : 'Sync the catalog first'}
      >
        {modelCatalog.length > 0 ? (
          <select
            id={name}
            name={name}
            defaultValue={value}
            disabled={!canEdit}
            className={inputClass}
          >
            {!currentInCatalog ? <option value={value}>{value} (current)</option> : null}
            {modelCatalog.map((model) => (
              <option key={model.id} value={model.id}>
                {model.name} - {model.id}
              </option>
            ))}
          </select>
        ) : (
          <input
            id={name}
            name={name}
            defaultValue={value}
            disabled={!canEdit}
            className={inputClass}
          />
        )}
      </Field>
    );
  };

  return (
    <>
      <PageHeader title="Settings" description="Budgets, batch sizes, and model selection." />
      {!canEdit ? <p className="mb-3 text-sm text-muted">Read-only — Admin can edit.</p> : null}
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <Card title="Budget & pipeline">
          <ActionForm action={updateSettingsAction} submitLabel="Save settings">
            <div className="grid grid-cols-2 gap-3">
              {numberField(
                'Monthly budget (USD)',
                'monthly_budget_usd',
                settings.monthly_budget_usd,
              )}
              {numberField(
                'Per-article ceiling (USD)',
                'per_article_cost_ceiling_usd',
                settings.per_article_cost_ceiling_usd,
              )}
              {numberField(
                'Keyword buffer target',
                'keyword_buffer_target',
                settings.keyword_buffer_target,
              )}
              {numberField('Briefs per run', 'briefs_per_run', settings.briefs_per_run)}
              {numberField('Max regen attempts', 'max_regen', settings.max_regen)}
            </div>
            <div className="mt-1 grid grid-cols-3 gap-3">
              {textModelField('Brief model', 'models.brief', settings.models.brief)}
              {textModelField('Draft model', 'models.draft', settings.models.draft)}
              {textModelField('QA model', 'models.qa', settings.models.qa)}
            </div>
            <div className="mt-1 grid gap-3 sm:grid-cols-2">
              <Field label="Image provider" name="imageGeneration.provider">
                <div className="rounded-md border border-border bg-panel-2 px-2.5 py-1.5 text-sm">
                  <Badge>Gemini</Badge>
                </div>
              </Field>
              <Field label="Image model" name="imageGeneration.model">
                <select
                  id="imageGeneration.model"
                  name="imageGeneration.model"
                  defaultValue={settings.imageGeneration.model}
                  disabled={!canEdit}
                  className={inputClass}
                >
                  {GEMINI_IMAGE_MODELS.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <label className="mt-1 flex items-center gap-2 rounded-md border border-border bg-panel-2 px-3 py-2 text-sm">
              <input
                type="checkbox"
                name="discovery_cron_enabled"
                defaultChecked={settings.discovery_cron_enabled}
                disabled={!canEdit}
              />{' '}
              Enable the weekly trending-topic discovery cron (only runs for sites opted in)
            </label>
          </ActionForm>
        </Card>

        <div className="grid content-start gap-4">
          <Card
            title="Gemini API key"
            description="Stored encrypted and used for article image generation."
          >
            <div className="grid gap-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted">Status</span>
                <Badge tone={geminiCredential.configured ? 'ok' : 'muted'}>
                  {geminiCredential.configured ? 'configured' : 'not set'}
                </Badge>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted">Stored key</span>
                <span>{geminiCredential.hasStoredKey ? 'Yes' : 'No'}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted">Env fallback</span>
                <span>{geminiCredential.hasEnvFallback ? 'Yes' : 'No'}</span>
              </div>
            </div>
            {canEdit ? (
              <ActionForm
                action={setGeminiApiKeyAction}
                submitLabel="Save key"
                className="mt-3 border-t border-border pt-3"
              >
                <Field label="API key" name="geminiApiKey">
                  <input
                    id="geminiApiKey"
                    name="geminiApiKey"
                    type="password"
                    required
                    className={inputClass}
                    autoComplete="off"
                  />
                </Field>
              </ActionForm>
            ) : null}
          </Card>

          <Card
            title="OpenRouter API key"
            description="Stored encrypted and used for model sync, style suggestions, and article drafts."
          >
            <div className="grid gap-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted">Status</span>
                <Badge tone={openRouterCredential.configured ? 'ok' : 'muted'}>
                  {openRouterCredential.configured ? 'configured' : 'not set'}
                </Badge>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted">Stored key</span>
                <span>{openRouterCredential.hasStoredKey ? 'Yes' : 'No'}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted">Env fallback</span>
                <span>{openRouterCredential.hasEnvFallback ? 'Yes' : 'No'}</span>
              </div>
            </div>
            {canEdit ? (
              <ActionForm
                action={setOpenRouterApiKeyAction}
                submitLabel="Save key"
                className="mt-3 border-t border-border pt-3"
              >
                <Field label="API key" name="openrouterApiKey">
                  <input
                    id="openrouterApiKey"
                    name="openrouterApiKey"
                    type="password"
                    required
                    className={inputClass}
                    autoComplete="off"
                  />
                </Field>
              </ActionForm>
            ) : null}
          </Card>

          <Card
            title="Google Search Console"
            description="Service-account JSON (read-only) for trending-topic discovery. Add the service account's email as a user on each GSC property."
          >
            <div className="grid gap-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted">Status</span>
                <Badge tone={gscCredential.configured ? 'ok' : 'muted'}>
                  {gscCredential.configured ? 'configured' : 'not set'}
                </Badge>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted">Stored key</span>
                <span>{gscCredential.hasStoredKey ? 'Yes' : 'No'}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted">Env fallback</span>
                <span>{gscCredential.hasEnvFallback ? 'Yes' : 'No'}</span>
              </div>
            </div>
            {canEdit ? (
              <ActionForm
                action={setGscServiceAccountAction}
                submitLabel="Save service account"
                className="mt-3 border-t border-border pt-3"
              >
                <Field
                  label="Service-account JSON"
                  name="serviceAccountJson"
                  hint="Paste the full JSON key. Stored encrypted; never returned to the browser."
                >
                  <textarea
                    id="serviceAccountJson"
                    name="serviceAccountJson"
                    required
                    rows={5}
                    className={`${inputClass} font-mono text-xs`}
                    autoComplete="off"
                    placeholder='{ "type": "service_account", "client_email": "...", "private_key": "..." }'
                  />
                </Field>
              </ActionForm>
            ) : null}
          </Card>

          <Card
            title="OpenRouter catalog"
            description="Text-output models available for brief, draft, and QA generation."
          >
            <div className="grid gap-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted">Provider</span>
                <Badge>OpenRouter</Badge>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted">Models synced</span>
                <span className="tabular-nums">{modelCatalog.length}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted">Last sync</span>
                <span className="text-right tabular-nums">{catalogSyncedAt}</span>
              </div>
            </div>
            {canEdit ? (
              <ActionForm
                action={syncOpenRouterModelsAction}
                submitLabel="Sync catalog"
                className="mt-3 border-t border-border pt-3"
              >
                <input type="hidden" name="provider" value="openrouter" />
              </ActionForm>
            ) : null}
          </Card>
        </div>
      </div>
    </>
  );
}
