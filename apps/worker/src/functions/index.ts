import type { inngest } from '../inngest/client';
import { weeklyKeywordDiscovery, discoveryRun } from './keyword-discovery';
import { pipelineTick } from './pipeline-tick';
import { articleAutodraft } from './article-autodraft';
import { publishOnApproval } from './publish';
import { reviewDigest } from './review-digest';

type ScribeFunction = ReturnType<typeof inngest.createFunction>;

/**
 * Pipeline function registry (Spec §6.8).
 *
 * The autopilot chain is: pipeline-tick decides and claims -> article-autodraft
 * drafts and enriches -> the article waits at PENDING_REVIEW for a human.
 * discovery-run keeps the keyword queue stocked.
 *
 * Publishing is deliberately NOT part of that chain: `publish-run` hangs off
 * `article.approved`, which only a human pressing Approve can cause, and it
 * re-verifies that human against the database before touching the CMS
 * (Spec §10.1.1).
 */
export const functions: ScribeFunction[] = [
  weeklyKeywordDiscovery,
  discoveryRun,
  pipelineTick,
  articleAutodraft,
  publishOnApproval,
  reviewDigest,
];
