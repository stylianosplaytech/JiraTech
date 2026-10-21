import { IssueStatus } from '@prisma/client';

/**
 * Service desk SLAs. Two clocks per request, both starting when it is created:
 *
 *  - Time to first response stops at the first public reply by an agent (or when the request is resolved).
 *  - Time to resolution stops when the request is resolved, and pauses while it sits in a status that
 *    pauses SLAs (e.g. "Waiting for customer"). Re-opening a request resumes it; the time it spent
 *    resolved doesn't count.
 *
 * Clocks run around the clock (no business-hours calendar). The issue stores just enough to
 * compute them: firstRespondedAt, resolvedAt, slaPausedAt and the total slaPausedSeconds.
 */

export interface SlaFields {
  createdAt: Date;
  firstRespondedAt: Date | null;
  resolvedAt: Date | null;
  slaPausedAt: Date | null;
  slaPausedSeconds: number;
}

export interface SlaGoals {
  firstResponseMinutes: number | null;
  resolutionMinutes: number | null;
}

export interface SlaClock {
  goalMinutes: number;
  elapsedMinutes: number;
  /** Negative once breached. */
  remainingMinutes: number;
  breached: boolean;
  /** The clock has stopped for good (responded / resolved). */
  completed: boolean;
  paused: boolean;
}

export interface Sla {
  firstResponse: SlaClock | null;
  resolution: SlaClock | null;
}

/** The SLA fields to write when an issue moves into status `to`. */
export function slaOnStatusChange(
  issue: Omit<SlaFields, 'createdAt'>,
  to: { category: IssueStatus; pausesSla: boolean },
  now = new Date(),
): Partial<Omit<SlaFields, 'createdAt'>> {
  const resolved = to.category === IssueStatus.CLOSED;
  const stopped = resolved || to.pausesSla;
  const data: Partial<Omit<SlaFields, 'createdAt'>> = {};
  if (stopped && !issue.slaPausedAt) data.slaPausedAt = now;
  if (!stopped && issue.slaPausedAt) {
    data.slaPausedAt = null;
    data.slaPausedSeconds = issue.slaPausedSeconds + Math.max(0, Math.round((now.getTime() - issue.slaPausedAt.getTime()) / 1000));
  }
  if (resolved) {
    if (!issue.resolvedAt) data.resolvedAt = now;
    // Resolving a request answers it.
    if (!issue.firstRespondedAt) data.firstRespondedAt = now;
  } else if (issue.resolvedAt) {
    data.resolvedAt = null;
  }
  return data;
}

export function computeSla(issue: SlaFields, goals: SlaGoals | null | undefined, now = new Date()): Sla {
  const minutes = (ms: number) => Math.max(0, Math.floor(ms / 60_000));
  const clock = (goal: number | null, elapsed: number, completed: boolean, paused: boolean): SlaClock | null => {
    if (goal == null) return null;
    return {
      goalMinutes: goal,
      elapsedMinutes: elapsed,
      remainingMinutes: goal - elapsed,
      breached: elapsed > goal,
      completed,
      paused: paused && !completed,
    };
  };

  const created = issue.createdAt.getTime();
  const responded = issue.firstRespondedAt ?? issue.resolvedAt;
  const firstResponse = clock(
    goals?.firstResponseMinutes ?? null,
    minutes((responded ?? now).getTime() - created),
    !!responded,
    false,
  );

  const pausedNow = issue.slaPausedAt ? now.getTime() - issue.slaPausedAt.getTime() : 0;
  const resolution = clock(
    goals?.resolutionMinutes ?? null,
    minutes(now.getTime() - created - issue.slaPausedSeconds * 1000 - pausedNow),
    !!issue.resolvedAt,
    !!issue.slaPausedAt,
  );
  return { firstResponse, resolution };
}
