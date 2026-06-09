'use server';

import { revalidatePath } from 'next/cache';
import {
  prisma,
  createSite,
  updateSite,
  setSiteStatus,
  setSiteCredentials,
  addKeywords,
  deleteKeyword,
  upsertStyleGuide,
  updateSetting,
  parseKeywordSeedList,
  parseBannedPhrases,
  AuthorizationError,
  type SettingKey,
} from '@scribe/core';
import { requireActor } from '@/lib/session';

export type FormState = { ok: boolean; error?: string; message?: string };

function toState(e: unknown): FormState {
  if (e instanceof AuthorizationError) {
    return { ok: false, error: 'You are not permitted to perform this action.' };
  }
  if (e && typeof e === 'object' && (e as { name?: string }).name === 'ZodError') {
    const issues = (e as { issues?: Array<{ message: string }> }).issues ?? [];
    return { ok: false, error: issues.map((i) => i.message).join('; ') || 'Invalid input.' };
  }
  return { ok: false, error: 'Something went wrong. Please try again.' };
}

const str = (v: FormDataEntryValue | null): string => (typeof v === 'string' ? v : '');
const optStr = (v: FormDataEntryValue | null): string | undefined => {
  const s = str(v).trim();
  return s.length > 0 ? s : undefined;
};

export async function createSiteAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const actor = await requireActor();
    await createSite(prisma, actor, {
      name: str(formData.get('name')),
      baseUrl: str(formData.get('baseUrl')),
      defaultAuthor: optStr(formData.get('defaultAuthor')),
      briefAutoApprove: formData.get('briefAutoApprove') === 'on',
    });
    revalidatePath('/sites');
    return { ok: true, message: 'Site created.' };
  } catch (e) {
    return toState(e);
  }
}

export async function updateSiteAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const actor = await requireActor();
    const id = str(formData.get('id'));
    await updateSite(prisma, actor, id, {
      name: str(formData.get('name')),
      baseUrl: str(formData.get('baseUrl')),
      defaultAuthor: optStr(formData.get('defaultAuthor')),
      briefAutoApprove: formData.get('briefAutoApprove') === 'on',
    });
    revalidatePath(`/sites/${id}`);
    revalidatePath('/sites');
    return { ok: true, message: 'Site updated.' };
  } catch (e) {
    return toState(e);
  }
}

export async function setSiteStatusAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const id = str(formData.get('id'));
  const status = str(formData.get('status')) === 'PAUSED' ? 'PAUSED' : 'ACTIVE';
  await setSiteStatus(prisma, actor, id, status);
  revalidatePath('/sites');
  revalidatePath(`/sites/${id}`);
}

export async function setCredentialsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const actor = await requireActor();
    const id = str(formData.get('id'));
    await setSiteCredentials(prisma, actor, id, {
      username: str(formData.get('username')),
      applicationPassword: str(formData.get('applicationPassword')),
    });
    revalidatePath(`/sites/${id}`);
    return { ok: true, message: 'Credentials saved (encrypted).' };
  } catch (e) {
    return toState(e);
  }
}

export async function addKeywordsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const actor = await requireActor();
    const siteId = str(formData.get('siteId'));
    const terms = parseKeywordSeedList(str(formData.get('terms')));
    const created = await addKeywords(prisma, actor, { siteId, terms });
    revalidatePath(`/sites/${siteId}`);
    return { ok: true, message: `Added ${created} keyword${created === 1 ? '' : 's'}.` };
  } catch (e) {
    return toState(e);
  }
}

export async function deleteKeywordAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const id = str(formData.get('id'));
  const siteId = str(formData.get('siteId'));
  await deleteKeyword(prisma, actor, id);
  revalidatePath(`/sites/${siteId}`);
}

export async function upsertStyleGuideAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireActor();
    const siteId = str(formData.get('siteId'));
    await upsertStyleGuide(prisma, actor, siteId, {
      systemPrompt: str(formData.get('systemPrompt')),
      toneNotes: optStr(formData.get('toneNotes')),
      formattingRules: optStr(formData.get('formattingRules')),
      readingLevel: optStr(formData.get('readingLevel')),
      bannedPhrases: parseBannedPhrases(str(formData.get('bannedPhrases'))),
    });
    revalidatePath(`/sites/${siteId}`);
    return { ok: true, message: 'Style guide saved.' };
  } catch (e) {
    return toState(e);
  }
}

const NUMERIC_SETTINGS: SettingKey[] = [
  'monthly_budget_usd',
  'per_article_cost_ceiling_usd',
  'keyword_buffer_target',
  'briefs_per_run',
  'max_regen',
];

export async function updateSettingsAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireActor();
    for (const key of NUMERIC_SETTINGS) {
      const raw = str(formData.get(key));
      if (raw === '') continue;
      await updateSetting(prisma, actor, key, Number(raw));
    }
    const models = {
      brief: str(formData.get('models.brief')),
      draft: str(formData.get('models.draft')),
      qa: str(formData.get('models.qa')),
    };
    if (models.brief && models.draft && models.qa) {
      await updateSetting(prisma, actor, 'models', models);
    }
    revalidatePath('/settings');
    return { ok: true, message: 'Settings saved.' };
  } catch (e) {
    return toState(e);
  }
}
