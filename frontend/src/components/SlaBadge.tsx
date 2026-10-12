import { formatDuration, type SlaClock } from '../api';
import { CheckIcon, ClockIcon } from './Icons';

/** How an SLA clock reads at a glance: met, breached, paused, at risk (under a quarter left) or on track. */
export function slaState(clock: SlaClock) {
  if (clock.completed) return clock.breached ? 'breached' : 'met';
  if (clock.breached) return 'breached';
  if (clock.paused) return 'paused';
  return clock.remainingMinutes <= clock.goalMinutes / 4 ? 'at-risk' : 'on-track';
}

const STYLES: Record<ReturnType<typeof slaState>, string> = {
  met: 'bg-[#E3FCEF] text-[#006644]',
  breached: 'bg-[#FFEBE6] text-[#BF2600]',
  paused: 'bg-jira-gray-hover text-[#42526E]',
  'at-risk': 'bg-[#FFFAE6] text-[#974F0C]',
  'on-track': 'bg-[#DEEBFF] text-[#0747A6]',
};

function describe(clock: SlaClock) {
  const goal = `Goal ${formatDuration(clock.goalMinutes)}`;
  if (clock.completed) {
    return clock.breached
      ? `Breached: took ${formatDuration(clock.elapsedMinutes)} (${goal})`
      : `Met in ${formatDuration(clock.elapsedMinutes)} (${goal})`;
  }
  if (clock.breached) return `Breached ${formatDuration(-clock.remainingMinutes)} ago (${goal})`;
  return `${formatDuration(clock.remainingMinutes)} left${clock.paused ? ', paused' : ''} (${goal})`;
}

export default function SlaBadge({ clock }: { clock: SlaClock | null | undefined }) {
  if (!clock) return <span className="text-jira-muted">—</span>;
  const state = slaState(clock);
  const text = clock.completed
    ? null
    : clock.remainingMinutes < 0 ? `-${formatDuration(-clock.remainingMinutes)}` : formatDuration(clock.remainingMinutes);
  return (
    <span className={`inline-flex items-center gap-1 rounded-[3px] px-1.5 py-0.5 text-xs font-semibold whitespace-nowrap ${STYLES[state]}`} title={describe(clock)}>
      {clock.completed ? <CheckIcon size={12} /> : <ClockIcon size={12} />}
      {text ?? (clock.breached ? 'Breached' : 'Met')}
      {state === 'paused' && <span className="font-normal">paused</span>}
    </span>
  );
}

/** Larger version for the issue sidebar: label, badge and an explanation. */
export function SlaRow({ label, clock }: { label: string; clock: SlaClock | null | undefined }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-jira-navy">{label}</div>
        <div className="text-xs text-jira-muted">{clock ? describe(clock) : 'No goal for this priority'}</div>
      </div>
      <SlaBadge clock={clock} />
    </div>
  );
}
