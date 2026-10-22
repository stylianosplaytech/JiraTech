import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, type BreakdownField, type SingleField, type Gadget, type GadgetData, type GadgetType } from '../api';
import { PriorityIcon, StatusBadge, TypeBadge, STATUS_LABELS, typeLabel } from './Badges';
import { errorMessage, Spinner } from './ui';
import { dueStatus, formatDueDate, humanize, timeAgo } from '../utils';

export const GADGET_TYPES: { type: GadgetType; label: string; hint: string }[] = [
  { type: 'FILTER_RESULTS', label: 'Issue list', hint: 'The issues a filter finds, newest first unless the filter sorts them.' },
  { type: 'FILTER_COUNT', label: 'Issue count', hint: 'One big number: how many issues a filter finds.' },
  { type: 'BREAKDOWN', label: 'Breakdown', hint: 'A filter’s issues counted by status, priority, type, assignee, reporter, project, label, component or fix version, as bars, a donut or a pie. An issue with several labels is counted under each.' },
  { type: 'TREND', label: 'Created over time', hint: 'How many of a filter’s issues were created each day or week, as bars or a line.' },
  { type: 'CREATED_VS_RESOLVED', label: 'Created vs resolved', hint: 'Issues created and issues resolved per day or week, side by side. Use a filter that includes closed issues, or nothing will show as resolved.' },
  { type: 'PROGRESS', label: 'Progress', hint: 'How much of a filter’s issues are closed, as a percentage bar. Use a filter that includes closed issues.' },
  { type: 'STACKED', label: 'Stacked breakdown', hint: 'A filter’s issues counted by one field, with each bar split by a second field, such as assignee by status.' },
  { type: 'RESOLUTION_TIME', label: 'Resolution time', hint: 'How long issues took from creation to resolution: average, median and how the times spread. Use a filter that includes closed issues.' },
  { type: 'DUE_DATES', label: 'Due dates', hint: 'Unresolved issues that are overdue or due soon, soonest first. Issues need a due date to appear.' },
  { type: 'RECENTLY_UPDATED', label: 'Recently updated', hint: 'The issues a filter finds, the most recently changed first, with how long ago.' },
  { type: 'ISSUE_AGE', label: 'Issue age', hint: 'How long unresolved issues have been open: average, median, oldest and how the ages spread.' },
  { type: 'BACKLOG_TREND', label: 'Backlog trend', hint: 'How many of a filter’s issues were unresolved at the end of each day or week, so you can see the backlog grow or shrink. Use a filter that includes closed issues.' },
  { type: 'RECENTLY_RESOLVED', label: 'Recently resolved', hint: 'The closed issues a filter finds, the most recently resolved first, with how long ago. Use a filter that includes closed issues.' },
  { type: 'UNASSIGNED', label: 'Unassigned issues', hint: 'Unresolved issues nobody is assigned to, the ones that have waited longest first.' },
  { type: 'PERIOD_COMPARISON', label: 'Period comparison', hint: 'Issues created and resolved in the last few days, against the same number of days before, with the change. Use a filter that includes closed issues.' },
  { type: 'STALE', label: 'Stale issues', hint: 'Unresolved issues nobody has touched for the longest time.' },
];

export const BREAKDOWN_LABELS: Record<BreakdownField, string> = {
  status: 'Status', priority: 'Priority', type: 'Issue type', assignee: 'Assignee', reporter: 'Reporter', project: 'Project',
  label: 'Label', component: 'Component', fixVersion: 'Fix version',
};

/** The fields a stacked breakdown can use: those every issue has exactly one value of. */
export const SINGLE_FIELD_KEYS: SingleField[] = ['status', 'priority', 'type', 'assignee', 'reporter', 'project'];

const PALETTE = ['#0052CC', '#36B37E', '#FFAB00', '#DE350B', '#6554C0', '#00B8D9', '#FF8B00', '#97A0AF'];

/** Donut of the groups, largest first; groups past the seventh are folded into "Other". */
function Donut({ pie = false, groups, color, label }: { pie?: boolean; groups: { key: string; label: string; count: number }[]; color: (key: string, i: number) => string; label: (g: { key: string; label: string }) => string }) {
  const shown = groups.length > 8 ? [...groups.slice(0, 7), { key: '__other', label: 'Other', count: groups.slice(7).reduce((n, g) => n + g.count, 0) }] : groups;
  const total = shown.reduce((n, g) => n + g.count, 0) || 1;
  const name = (g: { key: string; label: string }) => (g.key === '__other' ? 'Other' : label(g));
  const R = pie ? 50 : 40;
  const C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <div className="flex flex-wrap items-center gap-6">
      <svg viewBox="0 0 100 100" className="w-36 h-36 shrink-0 -rotate-90" role="img" aria-label="Breakdown chart">
        {shown.map((g, i) => {
          if (pie) {
            // Real wedges: a very wide stroke on a tiny circle renders unreliably.
            const start = (offset / C) * 2 * Math.PI;
            offset += (g.count / total) * C;
            const end = (offset / C) * 2 * Math.PI;
            const point = (a: number) => `${50 + 50 * Math.cos(a)} ${50 + 50 * Math.sin(a)}`;
            const d = shown.length === 1 || end - start >= 2 * Math.PI - 1e-6
              ? 'M50 0A50 50 0 1 1 50 100A50 50 0 1 1 50 0Z'
              : `M50 50L${point(start)}A50 50 0 ${end - start > Math.PI ? 1 : 0} 1 ${point(end)}Z`;
            return (
              <path key={g.key || 'none'} d={d} fill={color(g.key, i)} stroke="#fff" strokeWidth="0.5">
                <title>{`${name(g)}: ${g.count}`}</title>
              </path>
            );
          }
          const len = (g.count / total) * C;
          const el = (
            <circle key={g.key || 'none'} cx="50" cy="50" r={R} fill="none" strokeWidth={16} stroke={color(g.key, i)}
              strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-offset}>
              <title>{`${name(g)}: ${g.count}`}</title>
            </circle>
          );
          offset += len;
          return el;
        })}
      </svg>
      <ul className="flex-1 min-w-[140px] space-y-1.5">
        {shown.map((g, i) => (
          <li key={g.key || 'none'} className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-sm shrink-0" style={{ background: color(g.key, i) }} />
            <span className="truncate flex-1">{name(g)}</span>
            <span className="font-semibold">{g.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const COLORS: Record<string, string> = {
  BACKLOG: '#97A0AF', TO_DO: '#5E6C84', DOING: '#0052CC', CLOSED: '#36B37E',
  HIGHEST: '#DE350B', HIGH: '#FF5630', MEDIUM: '#FFAB00', LOW: '#2684FF', LOWEST: '#4C9AFF',
};

function groupLabel(field: BreakdownField, key: string, label: string) {
  if (field === 'status') return STATUS_LABELS[key] ?? humanize(key);
  if (field === 'priority') return humanize(key);
  if (field === 'type') return typeLabel(key);
  return label;
}

interface Series { name: string; color: string; values: number[] }

/** Per-day or per-week counts as bars (grouped when there are several series) or lines, with a legend for several series. */
function SeriesChart({ dates, series, kind, bucket, peak }: { dates: string[]; series: Series[]; kind: 'bars' | 'line'; bucket: 'day' | 'week'; peak?: (max: number) => string }) {
  const max = Math.max(...series.flatMap((s) => s.values), 1);
  const fmt = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  const tip = (i: number) => `${bucket === 'week' ? 'Week of ' : ''}${fmt(dates[i])}${series.map((s) => ` · ${s.name}: ${s.values[i]}`).join('')}`;
  const n = dates.length;
  const x = (i: number) => (n === 1 ? 50 : (i / (n - 1)) * 100);
  const y = (v: number) => 98 - (v / max) * 92;
  return (
    <div>
      {series.length > 1 && (
        <div className="flex gap-4 mb-2">
          {series.map((s) => (
            <span key={s.name} className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm" style={{ background: s.color }} />{s.name}</span>
          ))}
        </div>
      )}
      <div className="relative h-32" role="img" aria-label={`${series.map((s) => s.name).join(' and ')} over time`}>
        {kind === 'line' ? (
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 w-full h-full overflow-visible">
            <line x1="0" y1="98" x2="100" y2="98" stroke="#DFE1E6" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            {series.map((s) => (
              <polyline
                key={s.name}
                fill="none"
                stroke={s.color}
                strokeWidth="2"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
                points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ')}
              />
            ))}
          </svg>
        ) : (
          <div className="absolute inset-0 flex items-end gap-px">
            {dates.map((d, i) => (
              <div key={d} className="flex-1 h-full flex items-end gap-px">
                {series.map((s) => (
                  <div
                    key={s.name}
                    className="flex-1 rounded-t-[2px]"
                    style={{ background: s.color, height: s.values[i] ? `${Math.max((s.values[i] / max) * 100, 4)}%` : '2px', opacity: s.values[i] ? 1 : 0.25 }}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
        <div className="absolute inset-0 flex">
          {dates.map((d, i) => <div key={d} className="flex-1 h-full" title={tip(i)} />)}
        </div>
      </div>
      <div className="flex justify-between text-xs text-jira-muted mt-1.5">
        <span>{fmt(dates[0])}</span>
        <span>{peak ? peak(max) : `peak ${max} per ${bucket}`}</span>
        <span>{fmt(dates[n - 1])}</span>
      </div>
    </div>
  );
}

/** Wraps a filter-backed gadget's data in its loading, error and "filter deleted" states. */
export function GadgetBody({ dashboardId, gadget }: { dashboardId: string; gadget: Gadget }) {
  const { data, error, isLoading } = useQuery({
    queryKey: ['gadget-data', dashboardId, gadget.id, gadget.filterId, gadget.type, gadget.config],
    queryFn: () => api.getGadgetData(dashboardId, gadget.id),
    retry: false,
  });

  if (isLoading) return <Spinner />;
  if (error) return <p className="p-4 text-[#BF2600]">{errorMessage(error)}</p>;
  if (!data) return null;
  if ('filterMissing' in data) {
    return <p className="p-4 text-jira-muted">This gadget’s filter was deleted. Edit the gadget to pick another filter.</p>;
  }
  return <GadgetView data={data} />;
}

function GadgetView({ data }: { data: Exclude<GadgetData, { filterMissing: true }> }) {
  const searchLink = `/search?filter=${data.filterId}`;

  if (data.type === 'FILTER_COUNT') {
    return (
      <Link to={searchLink} className="block p-6 text-center hover:bg-jira-gray" title={`Open “${data.filterName}” in search`}>
        <p className="text-5xl font-semibold text-jira-navy">{data.total}</p>
        <p className="text-jira-subtle mt-1">{data.total === 1 ? 'issue' : 'issues'}</p>
      </Link>
    );
  }

  if (data.type === 'PROGRESS') {
    if (!data.total) return <p className="p-4 text-jira-muted">No issues match this filter.</p>;
    const pct = (n: number) => (n / data.total) * 100;
    const percent = Math.round(pct(data.done));
    return (
      <div className="p-4">
        <p className="flex items-baseline gap-2">
          <span className="text-4xl font-semibold text-jira-navy">{percent}%</span>
          <span className="text-jira-subtle">closed ({data.done} of {data.total})</span>
        </p>
        <div className="flex h-3 rounded-full overflow-hidden bg-jira-gray-hover mt-3" role="img" aria-label={`${percent}% closed`}>
          <div style={{ width: `${pct(data.done)}%`, background: COLORS.CLOSED }} title={`Closed: ${data.done}`} />
          <div style={{ width: `${pct(data.doing)}%`, background: COLORS.DOING }} title={`In progress: ${data.doing}`} />
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2.5">
          {[['Closed', data.done, COLORS.CLOSED], ['In progress', data.doing, COLORS.DOING], ['Not started', data.todo, '#DFE1E6']].map(([name, n, color]) => (
            <span key={name as string} className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm" style={{ background: color as string }} />{name} {n}</span>
          ))}
        </div>
        <p className="text-xs text-jira-muted pt-3"><Link to={searchLink} className="link">Open in search</Link></p>
      </div>
    );
  }

  if (data.type === 'STACKED') {
    if (!data.groups.length) return <p className="p-4 text-jira-muted">No issues match this filter.</p>;
    const max = Math.max(...data.groups.map((g) => g.total), 1);
    const shown = data.groups.slice(0, 12);
    const stackLabel = (key: string, label: string) => groupLabel(data.stackBy, key, label);
    const color = (key: string, i: number) => COLORS[key] ?? PALETTE[i % PALETTE.length];
    return (
      <div className="p-4 space-y-3">
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {data.stacks.map((s, i) => (
            <span key={s.key || 'none'} className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm" style={{ background: color(s.key, i) }} />{stackLabel(s.key, s.label)}</span>
          ))}
        </div>
        {shown.map((g) => (
          <div key={g.key || 'none'}>
            <div className="flex justify-between mb-1">
              <span className="truncate">{groupLabel(data.groupBy, g.key, g.label)}</span>
              <span className="font-semibold">{g.total}</span>
            </div>
            <div className="flex h-2.5 rounded-full overflow-hidden bg-jira-gray-hover" style={{ width: `${(g.total / max) * 100}%` }}>
              {g.counts.map((n, i) => n > 0 && (
                <div key={data.stacks[i].key || 'none'} style={{ width: `${(n / g.total) * 100}%`, background: color(data.stacks[i].key, i) }}
                  title={`${stackLabel(data.stacks[i].key, data.stacks[i].label)}: ${n}`} />
              ))}
            </div>
          </div>
        ))}
        <p className="text-xs text-jira-muted pt-1">
          {data.total} {data.total === 1 ? 'issue' : 'issues'}{data.groups.length > shown.length && ` · top ${shown.length} of ${data.groups.length} shown`} · <Link to={searchLink} className="link">Open in search</Link>
        </p>
      </div>
    );
  }

  if (data.type === 'RESOLUTION_TIME') {
    if (!data.resolved) return <p className="p-4 text-jira-muted">No issues from this filter were resolved in the last {data.days} days.</p>;
    const max = Math.max(...data.bands.map((b) => b.count), 1);
    const stat = (label: string, days: number | null) => (
      <div className="flex-1 text-center">
        <p className="text-2xl font-semibold text-jira-navy">{days === null ? '–' : days}<span className="text-sm font-normal text-jira-subtle"> days</span></p>
        <p className="text-xs text-jira-muted">{label}</p>
      </div>
    );
    return (
      <div className="p-4">
        <div className="flex gap-2 pb-3">{stat('Average', data.averageDays)}{stat('Median', data.medianDays)}{stat('Slowest', data.slowestDays)}</div>
        <div className="space-y-1.5">
          {data.bands.map((b) => (
            <div key={b.label} className="flex items-center gap-2" title={`${b.label}: ${b.count}`}>
              <span className="w-20 shrink-0 text-xs text-jira-subtle">{b.label}</span>
              <div className="flex-1 h-2 rounded-full bg-jira-gray-hover overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${(b.count / max) * 100}%`, background: '#0052CC' }} />
              </div>
              <span className="w-6 text-right font-semibold">{b.count}</span>
            </div>
          ))}
        </div>
        <p className="text-xs text-jira-muted pt-3">
          {data.resolved} resolved in the last {data.days} days · <Link to={searchLink} className="link">Open filter in search</Link>
        </p>
      </div>
    );
  }

  if (data.type === 'RECENTLY_UPDATED') {
    if (!data.issues.length) return <p className="p-4 text-jira-muted">No issues match this filter.</p>;
    return (
      <>
        <div className="divide-y divide-jira-border">
          {data.issues.map((issue) => (
            <Link key={issue.id} to={`/browse/${issue.key}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-jira-gray">
              <TypeBadge type={issue.type} />
              <span className={`link shrink-0 ${issue.status === 'CLOSED' ? 'line-through' : ''}`}>{issue.key}</span>
              <span className="truncate flex-1">{issue.summary}</span>
              <span className="hidden sm:block shrink-0"><StatusBadge status={issue.status} name={issue.workflowStatus?.name} /></span>
              <span className="shrink-0 text-xs text-jira-muted w-24 text-right" title={issue.updatedAt ? new Date(issue.updatedAt).toLocaleString() : undefined}>{issue.updatedAt ? timeAgo(issue.updatedAt) : ''}</span>
            </Link>
          ))}
        </div>
        {data.total > data.issues.length && (
          <div className="px-4 py-2.5 border-t border-jira-border text-xs text-jira-muted">
            Showing {data.issues.length} of {data.total} · <Link to={searchLink} className="link">See all in search</Link>
          </div>
        )}
      </>
    );
  }

  if (data.type === 'RECENTLY_RESOLVED') {
    if (!data.issues.length) return <p className="p-4 text-jira-muted">No closed issues match this filter.</p>;
    return (
      <>
        <div className="divide-y divide-jira-border">
          {data.issues.map((issue) => {
            const when = issue.resolvedAt ?? issue.updatedAt;
            return (
              <Link key={issue.id} to={`/browse/${issue.key}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-jira-gray">
                <TypeBadge type={issue.type} />
                <span className="link shrink-0 line-through">{issue.key}</span>
                <span className="truncate flex-1">{issue.summary}</span>
                <PriorityIcon priority={issue.priority} />
                <span className="shrink-0 text-xs text-jira-muted w-24 text-right" title={when ? new Date(when).toLocaleString() : undefined}>{when ? timeAgo(when) : ''}</span>
              </Link>
            );
          })}
        </div>
        {data.total > data.issues.length && (
          <div className="px-4 py-2.5 border-t border-jira-border text-xs text-jira-muted">
            Showing {data.issues.length} of {data.total} closed · <Link to={searchLink} className="link">See all in search</Link>
          </div>
        )}
      </>
    );
  }

  if (data.type === 'UNASSIGNED') {
    if (!data.issues.length) return <p className="p-4 text-jira-muted">Every unresolved issue has an assignee.</p>;
    return (
      <>
        <div className="divide-y divide-jira-border">
          {data.issues.map((issue) => (
            <Link key={issue.id} to={`/browse/${issue.key}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-jira-gray">
              <TypeBadge type={issue.type} />
              <span className="link shrink-0">{issue.key}</span>
              <span className="truncate flex-1">{issue.summary}</span>
              <PriorityIcon priority={issue.priority} />
              <span className="hidden sm:block shrink-0"><StatusBadge status={issue.status} name={issue.workflowStatus?.name} /></span>
              <span className="shrink-0 text-xs text-jira-muted w-24 text-right" title={issue.createdAt ? `Created ${new Date(issue.createdAt).toLocaleString()}` : undefined}>{issue.createdAt ? timeAgo(issue.createdAt) : ''}</span>
            </Link>
          ))}
        </div>
        <div className="px-4 py-2.5 border-t border-jira-border text-xs text-jira-muted">
          {data.total} unassigned · <Link to={searchLink} className="link">Open filter in search</Link>
        </div>
      </>
    );
  }

  if (data.type === 'PERIOD_COMPARISON') {
    // For created, more is bad news; for resolved, more is good.
    const stat = (label: string, s: { current: number; previous: number }, upIsGood: boolean) => {
      const change = s.current - s.previous;
      const color = change === 0 ? 'text-jira-muted' : change > 0 === upIsGood ? 'text-[#006644]' : 'text-[#BF2600]';
      return (
        <div className="flex-1 text-center">
          <p className="text-4xl font-semibold text-jira-navy">{s.current}</p>
          <p className="text-jira-subtle">{label}</p>
          <p className={`text-xs mt-1 ${color}`}>
            {change === 0 ? 'no change' : `${change > 0 ? '▲' : '▼'} ${Math.abs(change)}`} <span className="text-jira-muted">(was {s.previous})</span>
          </p>
        </div>
      );
    };
    return (
      <div className="p-4">
        <div className="flex gap-2">{stat('created', data.created, false)}{stat('resolved', data.resolved, true)}</div>
        <p className="text-xs text-jira-muted pt-3">
          Last {data.days} days, against the {data.days} days before · <Link to={searchLink} className="link">Open filter in search</Link>
        </p>
      </div>
    );
  }

  if (data.type === 'ISSUE_AGE') {
    if (!data.open) return <p className="p-4 text-jira-muted">No unresolved issues match this filter.</p>;
    const max = Math.max(...data.bands.map((b) => b.count), 1);
    const stat = (label: string, days: number | null) => (
      <div className="flex-1 text-center">
        <p className="text-2xl font-semibold text-jira-navy">{days === null ? '–' : Math.round(days)}<span className="text-sm font-normal text-jira-subtle"> days</span></p>
        <p className="text-xs text-jira-muted">{label}</p>
      </div>
    );
    return (
      <div className="p-4">
        <div className="flex gap-2 pb-3">{stat('Average age', data.averageDays)}{stat('Median', data.medianDays)}{stat('Oldest', data.oldestDays)}</div>
        <div className="space-y-1.5">
          {data.bands.map((b, i) => (
            <div key={b.label} className="flex items-center gap-2" title={`${b.label}: ${b.count}`}>
              <span className="w-20 shrink-0 text-xs text-jira-subtle">{b.label}</span>
              <div className="flex-1 h-2 rounded-full bg-jira-gray-hover overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${(b.count / max) * 100}%`, background: ['#36B37E', '#36B37E', '#FFAB00', '#FF8B00', '#DE350B'][i] }} />
              </div>
              <span className="w-6 text-right font-semibold">{b.count}</span>
            </div>
          ))}
        </div>
        <p className="text-xs text-jira-muted pt-3">
          {data.open} unresolved {data.open === 1 ? 'issue' : 'issues'} · <Link to={searchLink} className="link">Open filter in search</Link>
        </p>
      </div>
    );
  }

  if (data.type === 'BACKLOG_TREND') {
    return (
      <div className="p-4">
        <SeriesChart
          kind={data.chart}
          bucket={data.bucket}
          dates={data.points.map((p) => p.date)}
          series={[{ name: 'Unresolved', color: '#6554C0', values: data.points.map((p) => p.count) }]}
          peak={(max) => `peak ${max} unresolved`}
        />
        <p className="text-xs text-jira-muted pt-3">
          {data.current} unresolved now (
          {data.change > 0 ? `up ${data.change}` : data.change < 0 ? `down ${-data.change}` : 'no change'} over {data.days} days) ·{' '}
          <Link to={searchLink} className="link">Open filter in search</Link>
        </p>
      </div>
    );
  }

  if (data.type === 'DUE_DATES') {
    const summary = (
      <div className="flex gap-6 px-4 pt-3 pb-1">
        <span><span className={`text-2xl font-semibold ${data.overdue ? 'text-[#BF2600]' : 'text-jira-navy'}`}>{data.overdue}</span> <span className="text-jira-subtle">overdue</span></span>
        <span><span className="text-2xl font-semibold text-jira-navy">{data.upcoming}</span> <span className="text-jira-subtle">due in the next {data.days} days</span></span>
      </div>
    );
    if (!data.issues.length) {
      return <>{summary}<p className="px-4 pb-4 pt-2 text-jira-muted">Nothing overdue or due soon.</p></>;
    }
    return (
      <>
        {summary}
        <div className="divide-y divide-jira-border mt-2 border-t border-jira-border">
          {data.issues.map((issue) => {
            const status = issue.dueDate ? dueStatus(issue.dueDate) : null;
            return (
              <Link key={issue.id} to={`/browse/${issue.key}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-jira-gray">
                <TypeBadge type={issue.type} />
                <span className="link shrink-0">{issue.key}</span>
                <span className="truncate flex-1">{issue.summary}</span>
                <PriorityIcon priority={issue.priority} />
                {status && issue.dueDate && (
                  <span className={`shrink-0 text-xs w-36 text-right ${status.overdue ? 'text-[#BF2600] font-semibold' : 'text-jira-muted'}`} title={formatDueDate(issue.dueDate)}>{status.label}</span>
                )}
              </Link>
            );
          })}
        </div>
        {data.overdue + data.upcoming > data.issues.length && (
          <div className="px-4 py-2.5 border-t border-jira-border text-xs text-jira-muted">
            Showing {data.issues.length} of {data.overdue + data.upcoming} · <Link to={searchLink} className="link">Open filter in search</Link>
          </div>
        )}
      </>
    );
  }

  if (data.type === 'STALE') {
    if (!data.issues.length) return <p className="p-4 text-jira-muted">No unresolved issues match this filter.</p>;
    const idle = (iso?: string) => {
      const days = iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000) : 0;
      return days < 1 ? 'today' : days === 1 ? '1 day' : days < 60 ? `${days} days` : `${Math.round(days / 30)} months`;
    };
    return (
      <>
        <div className="divide-y divide-jira-border">
          {data.issues.map((issue) => (
            <Link key={issue.id} to={`/browse/${issue.key}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-jira-gray">
              <TypeBadge type={issue.type} />
              <span className="link shrink-0">{issue.key}</span>
              <span className="truncate flex-1">{issue.summary}</span>
              <PriorityIcon priority={issue.priority} />
              <span className="shrink-0 text-xs text-jira-muted w-20 text-right" title={issue.updatedAt ? `Last updated ${new Date(issue.updatedAt).toLocaleString()}` : undefined}>idle {idle(issue.updatedAt)}</span>
            </Link>
          ))}
        </div>
        {data.total > data.issues.length && (
          <div className="px-4 py-2.5 border-t border-jira-border text-xs text-jira-muted">
            Showing {data.issues.length} of {data.total} unresolved · <Link to={searchLink} className="link">See all in search</Link>
          </div>
        )}
      </>
    );
  }

  if (data.type === 'TREND') {
    return (
      <div className="p-4">
        <SeriesChart
          kind={data.chart}
          bucket={data.bucket}
          dates={data.points.map((p) => p.date)}
          series={[{ name: 'Created', color: '#0052CC', values: data.points.map((p) => p.count) }]}
        />
        <p className="text-xs text-jira-muted pt-3">
          {data.total} created in the last {data.days} days · <Link to={searchLink} className="link">Open filter in search</Link>
        </p>
      </div>
    );
  }

  if (data.type === 'CREATED_VS_RESOLVED') {
    const net = data.createdTotal - data.resolvedTotal;
    return (
      <div className="p-4">
        <SeriesChart
          kind={data.chart}
          bucket={data.bucket}
          dates={data.points.map((p) => p.date)}
          series={[
            { name: 'Created', color: '#DE350B', values: data.points.map((p) => p.created) },
            { name: 'Resolved', color: '#36B37E', values: data.points.map((p) => p.resolved) },
          ]}
        />
        <p className="text-xs text-jira-muted pt-3">
          Last {data.days} days: {data.createdTotal} created, {data.resolvedTotal} resolved (
          {net > 0 ? `backlog grew by ${net}` : net < 0 ? `backlog shrank by ${-net}` : 'backlog unchanged'}) ·{' '}
          <Link to={searchLink} className="link">Open filter in search</Link>
        </p>
      </div>
    );
  }

  if (data.type === 'BREAKDOWN') {
    const max = Math.max(...data.groups.map((g) => g.count), 1);
    if (!data.groups.length) return <p className="p-4 text-jira-muted">No issues match this filter.</p>;
    if (data.chart === 'donut' || data.chart === 'pie') {
      return (
        <div className="p-4">
          <Donut
            pie={data.chart === 'pie'}
            groups={data.groups}
            color={(key, i) => COLORS[key] ?? PALETTE[i % PALETTE.length]}
            label={(g) => groupLabel(data.groupBy, g.key, g.label)}
          />
          <p className="text-xs text-jira-muted pt-3">
            {data.total} {data.total === 1 ? 'issue' : 'issues'} · <Link to={searchLink} className="link">Open in search</Link>
          </p>
        </div>
      );
    }
    return (
      <div className="p-4 space-y-3">
        {data.groups.map((g) => (
          <div key={g.key || 'none'}>
            <div className="flex justify-between mb-1">
              <span>{groupLabel(data.groupBy, g.key, g.label)}</span>
              <span className="font-semibold">{g.count}</span>
            </div>
            <div className="h-2 rounded-full bg-jira-gray-hover overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${(g.count / max) * 100}%`, background: COLORS[g.key] ?? '#0052CC' }} />
            </div>
          </div>
        ))}
        <p className="text-xs text-jira-muted pt-1">
          {data.total} {data.total === 1 ? 'issue' : 'issues'} · <Link to={searchLink} className="link">Open in search</Link>
        </p>
      </div>
    );
  }

  if (!data.issues.length) return <p className="p-4 text-jira-muted">No issues match this filter.</p>;
  return (
    <>
      <div className="divide-y divide-jira-border">
        {data.issues.map((issue) => (
          <Link key={issue.id} to={`/browse/${issue.key}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-jira-gray">
            <TypeBadge type={issue.type} />
            <span className={`link shrink-0 ${issue.status === 'CLOSED' ? 'line-through' : ''}`}>{issue.key}</span>
            <span className="truncate flex-1">{issue.summary}</span>
            <PriorityIcon priority={issue.priority} />
            <span className="hidden sm:block shrink-0"><StatusBadge status={issue.status} name={issue.workflowStatus?.name} /></span>
          </Link>
        ))}
      </div>
      {data.total > data.issues.length && (
        <div className="px-4 py-2.5 border-t border-jira-border text-xs text-jira-muted">
          Showing {data.issues.length} of {data.total} · <Link to={searchLink} className="link">See all in search</Link>
        </div>
      )}
    </>
  );
}
