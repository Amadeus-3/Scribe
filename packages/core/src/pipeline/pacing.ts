/**
 * Autopilot pacing (Spec §16, Decision: dashboard-controlled cadence).
 *
 * Inngest cron expressions are static in the function definition and only take
 * effect on re-registration, so cadence CANNOT live in the cron. A fixed tick
 * fires often and every policy question is answered here, from Settings read at
 * runtime. The line to hold:
 *
 *   Inngest flow control expresses SAFETY   (concurrency, idempotency, retries)
 *   Settings express POLICY                 (cadence, targets, run windows)
 *
 * Encoding cadence in throttle/rateLimit would give two sources of truth and
 * make the dashboard lie about what the system is doing.
 *
 * Everything here is pure and takes an injected `now`, so it is exhaustively
 * unit-testable with no database and no Inngest.
 */

const MINUTES_PER_WEEK = 7 * 24 * 60;
const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface RunWindow {
  /** 0=Sun..6=Sat. Empty means every day. */
  daysOfWeek: number[];
  /** Inclusive, 0..23. */
  startHour: number;
  /** Exclusive, 1..24. */
  endHour: number;
  /** Fixed offset rather than an IANA zone, so this needs no tz database. */
  timezoneOffsetMinutes: number;
}

export interface PacingConfig {
  /** 0 pauses the site without touching the master switch. */
  articlesPerWeek: number;
  /** Cap on PENDING_REVIEW + CHANGES_REQUESTED. 0 = unlimited. */
  maxUnreviewed: number;
  /** 0 = derive an even spacing from articlesPerWeek. */
  minSpacingMinutes: number;
  runWindow: RunWindow;
}

export interface PacingInputs {
  now: Date;
  /** Articles created for this site since rollingWindowStart(now). */
  articlesInWindow: number;
  /** createdAt of the site's newest Article of ANY origin, or null. */
  lastArticleAt: Date | null;
  /** PENDING_REVIEW + CHANGES_REQUESTED for this site. */
  unreviewed: number;
  /** Claimable QUEUED keywords for this site. */
  queuedKeywords: number;
}

export type PacingSkipReason =
  | 'paused'
  | 'outside_run_window'
  | 'weekly_target_met'
  | 'unreviewed_backlog_full'
  | 'spacing_not_elapsed'
  | 'no_queued_keywords';

export interface PacingDecision {
  /**
   * Drafts to start on this tick. Structurally 0 or 1 — never more.
   *
   * This is the most important safety property in the autopilot: combined with
   * the spacing check it makes bursts impossible, bounds worst-case budget
   * overshoot to a single article, and means a bug in the arithmetic below can
   * never fan out twenty paid drafts. Throughput is not the constraint: at 5
   * articles/week the spacing is ~34h, so a 15-minute tick only becomes the
   * bottleneck above 672 articles/week.
   */
  slots: 0 | 1;
  reason: PacingSkipReason | 'ok';
  detail: {
    windowStart: Date;
    spacingMinutes: number;
    /** When the next draft becomes eligible on spacing grounds. */
    nextEligibleAt: Date | null;
    remainingThisWeek: number;
    /** Remaining room under maxUnreviewed; Infinity when unlimited. */
    backlogHeadroom: number;
  };
}

/** Start of the rolling throughput window (default 7 days back from `now`). */
export function rollingWindowStart(now: Date, days = 7): Date {
  return new Date(now.getTime() - days * MS_PER_DAY);
}

/** Even spacing implied by a weekly target, e.g. 3/week -> one per 56h. */
export function derivedSpacingMinutes(articlesPerWeek: number): number {
  if (articlesPerWeek <= 0) return Number.POSITIVE_INFINITY;
  return MINUTES_PER_WEEK / articlesPerWeek;
}

/** An explicit override wins; otherwise spacing follows the weekly target. */
export function effectiveSpacingMinutes(config: PacingConfig): number {
  return config.minSpacingMinutes > 0
    ? config.minSpacingMinutes
    : derivedSpacingMinutes(config.articlesPerWeek);
}

export function isWithinRunWindow(now: Date, window: RunWindow): boolean {
  // Shift into the configured offset, then read the calendar fields in UTC so
  // the host machine's own timezone never leaks into the decision.
  const local = new Date(now.getTime() + window.timezoneOffsetMinutes * MS_PER_MINUTE);
  const day = local.getUTCDay();
  const hour = local.getUTCHours();

  if (window.daysOfWeek.length > 0 && !window.daysOfWeek.includes(day)) return false;

  // A window whose end wraps past midnight (e.g. 22 -> 6) is two ranges.
  return window.startHour <= window.endHour
    ? hour >= window.startHour && hour < window.endHour
    : hour >= window.startHour || hour < window.endHour;
}

/**
 * Decide whether this site may start one draft right now.
 *
 * Checks run cheapest-and-most-decisive first, and the returned `reason` is
 * surfaced verbatim in the dashboard so an idle autopilot always explains
 * itself rather than looking broken.
 */
export function decidePacing(config: PacingConfig, inputs: PacingInputs): PacingDecision {
  const windowStart = rollingWindowStart(inputs.now);
  const spacingMinutes = effectiveSpacingMinutes(config);
  const remainingThisWeek = Math.max(0, config.articlesPerWeek - inputs.articlesInWindow);
  const backlogHeadroom =
    config.maxUnreviewed > 0
      ? Math.max(0, config.maxUnreviewed - inputs.unreviewed)
      : Number.POSITIVE_INFINITY;
  const nextEligibleAt =
    inputs.lastArticleAt && Number.isFinite(spacingMinutes)
      ? new Date(inputs.lastArticleAt.getTime() + spacingMinutes * MS_PER_MINUTE)
      : null;

  const detail = {
    windowStart,
    spacingMinutes,
    nextEligibleAt,
    remainingThisWeek,
    backlogHeadroom,
  };
  const skip = (reason: PacingSkipReason): PacingDecision => ({ slots: 0, reason, detail });

  if (config.articlesPerWeek <= 0) return skip('paused');
  if (!isWithinRunWindow(inputs.now, config.runWindow)) return skip('outside_run_window');
  if (remainingThisWeek <= 0) return skip('weekly_target_met');
  // Self-limiting: stop producing for a reviewer who has stopped reviewing, so
  // an unread pile can never quietly drain the monthly budget.
  if (backlogHeadroom <= 0) return skip('unreviewed_backlog_full');
  if (nextEligibleAt && inputs.now < nextEligibleAt) return skip('spacing_not_elapsed');
  if (inputs.queuedKeywords <= 0) return skip('no_queued_keywords');

  return { slots: 1, reason: 'ok', detail };
}
