import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, type ReportData, type ReportIssueRow, type TypeGroup } from '../api';
import { useProject } from '../project';
import { typeLabel } from '../components/Badges';
import { EmptyState, PageHeader, Spinner, errorMessage, useToast } from '../components/ui';
import { humanize } from '../utils';

// ─── Palette ─────────────────────────────────────────────────────────────────

// Greens for done/in-progress work, warm tones for work that hasn't started.
const CATEGORY_SHADES: Record<string, string[]> = {
  CLOSED: ['#1F4E3D', '#2C6A50', '#3B7F62'],
  DOING: ['#2E8B57', '#4CAF7D', '#6FBF95', '#8FCFAB', '#5E9C80', '#79A98F'],
  TO_DO: ['#7FB8A4', '#A8D5BA', '#5F8F86', '#B5C9A7'],
  BACKLOG: ['#C5672B', '#D9A066', '#B9C2BE', '#9A6B3E'],
};
const SERIES = ['#1F4E3D', '#2E8B57', '#4CAF7D', '#C5672B', '#6B7F3A', '#5E7A75', '#D9A066', '#8FCFAB', '#B9C2BE', '#9A6B3E', '#A8D5BA', '#3B7F62'];
const PRIORITY_COLORS: Record<string, string> = {
  HIGHEST: '#8E2C1B', HIGH: '#C0442B', MEDIUM: '#C5672B', LOW: '#2C6A50', LOWEST: '#8FCFAB',
};
const GROUP_COLORS: Record<TypeGroup, string> = {
  EPIC: '#1F4E3D', STORY: '#4CAF7D', BUG: '#C5672B', TASK: '#A8D5BA', OTHER: '#B9C2BE',
};
const GROUP_LABELS: Record<TypeGroup, string> = { EPIC: 'Epics', STORY: 'Stories', BUG: 'Bugs', TASK: 'Tasks', OTHER: 'Other' };
const TIMELINE_COLORS: Record<string, string> = { DOING: '#2E8B57', TO_DO: '#8FCFAB', BACKLOG: '#D9A066' };
const TIMELINE_LABELS: Record<string, string> = { DOING: 'In progress', TO_DO: 'To do', BACKLOG: 'Backlog' };

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB');
const pct = (n: number, total: number) => (total ? Math.round((n / total) * 100) : 0);
const priorityLabel = (p: string) => p.charAt(0) + p.slice(1).toLowerCase();
const monthLabel = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' });
};
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

// ─── Charts (plain SVG) ──────────────────────────────────────────────────────

interface Slice { label: string; value: number; color: string }

function Donut({ slices, size = 200 }: { slices: Slice[]; size?: number }) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  const r = size / 2;
  const inner = r * 0.48;
  const mid = (r + inner) / 2;
  if (!total) return <p className="text-jira-muted text-sm py-10 text-center">No data</p>;

  let angle = -Math.PI / 2;
  const point = (rad: number, a: number) => [r + rad * Math.cos(a), r + rad * Math.sin(a)];
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} className="mx-auto block" role="img">
      {slices.filter((s) => s.value > 0).map((s) => {
        const share = s.value / total;
        const start = angle;
        const end = angle + share * Math.PI * 2;
        angle = end;
        const [lx, ly] = point(mid, (start + end) / 2);
        const label = share >= 0.04 && (
          <text x={lx} y={ly} textAnchor="middle" dominantBaseline="central" fontSize={10} fontWeight={600} fill="#fff">
            {Math.round(share * 100)}%
          </text>
        );
        if (share >= 0.9999) {
          return (
            <g key={s.label}>
              <circle cx={r} cy={r} r={mid} fill="none" stroke={s.color} strokeWidth={r - inner}><title>{`${s.label}: ${s.value}`}</title></circle>
              <text x={r} y={r - mid} textAnchor="middle" dominantBaseline="central" fontSize={10} fontWeight={600} fill="#fff">100%</text>
            </g>
          );
        }
        const large = end - start > Math.PI ? 1 : 0;
        const [x1, y1] = point(r, start);
        const [x2, y2] = point(r, end);
        const [x3, y3] = point(inner, end);
        const [x4, y4] = point(inner, start);
        return (
          <g key={s.label}>
            <path
              d={`M${x1},${y1} A${r},${r} 0 ${large} 1 ${x2},${y2} L${x3},${y3} A${inner},${inner} 0 ${large} 0 ${x4},${y4} Z`}
              fill={s.color}
              stroke="#fff"
              strokeWidth={1}
            >
              <title>{`${s.label}: ${s.value} (${Math.round(share * 100)}%)`}</title>
            </path>
            {label}
          </g>
        );
      })}
    </svg>
  );
}

function Legend({ slices, columns = 1 }: { slices: Slice[]; columns?: 1 | 2 }) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  return (
    <ul className={`mt-4 grid gap-x-4 gap-y-1 text-xs ${columns === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
      {slices.map((s) => (
        <li key={s.label} className="flex items-start gap-2">
          <span className="w-2.5 h-2.5 rounded-sm mt-[3px] shrink-0" style={{ background: s.color }} />
          <span><span className="font-medium">{s.label}</span> · {s.value} ({pct(s.value, total)}%)</span>
        </li>
      ))}
    </ul>
  );
}

function ColumnChart({ bars, height = 220 }: { bars: Slice[]; height?: number }) {
  const max = Math.max(...bars.map((b) => b.value), 1);
  if (!bars.length) return <p className="text-jira-muted text-sm py-10 text-center">No data</p>;
  const w = 56;
  const width = bars.length * w;
  const top = 18;
  const bottom = 34;
  const plot = height - top - bottom;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ maxHeight: height }} preserveAspectRatio="xMidYMid meet" role="img">
      <line x1={0} x2={width} y1={top + plot} y2={top + plot} stroke="#DFE1E6" />
      {bars.map((b, i) => {
        const h = (b.value / max) * plot;
        const x = i * w + w * 0.2;
        return (
          <g key={b.label}>
            <rect x={x} y={top + plot - h} width={w * 0.6} height={h} fill={b.color} rx={2}><title>{`${b.label}: ${b.value}`}</title></rect>
            <text x={x + w * 0.3} y={top + plot - h - 5} textAnchor="middle" fontSize={10} fill="#42526E">{b.value}</text>
            <text x={x + w * 0.3} y={top + plot + 14} textAnchor="middle" fontSize={10} fill="#42526E">
              {b.label.length > 10 ? `${b.label.slice(0, 9)}…` : b.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function HBarChart({ bars }: { bars: Slice[] }) {
  const max = Math.max(...bars.map((b) => b.value), 1);
  if (!bars.length) return <p className="text-jira-muted text-sm py-10 text-center">No data</p>;
  return (
    <div className="space-y-1.5">
      {bars.map((b) => (
        <div key={b.label} className="flex items-center gap-2 text-xs">
          <span className="w-28 truncate text-right text-jira-subtle" title={b.label}>{b.label}</span>
          <div className="flex-1 flex items-center gap-1.5">
            <div className="h-3.5 rounded-sm" style={{ width: `${(b.value / max) * 100}%`, minWidth: 2, background: b.color }} />
            <span className="font-medium">{b.value}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function MonthlyChart({ months }: { months: ReportData['closedPerMonth'] }) {
  const groups = (Object.keys(GROUP_COLORS) as TypeGroup[]).filter((g) => months.some((m) => m[g] > 0));
  const max = Math.max(...months.map((m) => m.total), 1);
  const height = 240;
  const top = 18;
  const bottom = 28;
  const plot = height - top - bottom;
  const w = 40;
  const width = months.length * w;
  return (
    <>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ maxHeight: height }} role="img">
        <line x1={0} x2={width} y1={top + plot} y2={top + plot} stroke="#DFE1E6" />
        {months.map((m, i) => {
          let y = top + plot;
          const x = i * w + w * 0.18;
          const bw = w * 0.64;
          return (
            <g key={m.month}>
              {groups.map((g) => {
                const h = (m[g] / max) * plot;
                y -= h;
                return h > 0 ? (
                  <rect key={g} x={x} y={y} width={bw} height={h} fill={GROUP_COLORS[g]}>
                    <title>{`${monthLabel(m.month)} · ${GROUP_LABELS[g]}: ${m[g]}`}</title>
                  </rect>
                ) : null;
              })}
              {m.total > 0 && <text x={x + bw / 2} y={y - 4} textAnchor="middle" fontSize={9} fill="#42526E">{m.total}</text>}
              <text x={x + bw / 2} y={top + plot + 14} textAnchor="middle" fontSize={8.5} fill="#42526E">{monthLabel(m.month)}</text>
            </g>
          );
        })}
      </svg>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs mt-2">
        {groups.map((g) => (
          <span key={g} className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: GROUP_COLORS[g] }} /> {GROUP_LABELS[g]}
          </span>
        ))}
      </div>
    </>
  );
}

// ─── Layout pieces ───────────────────────────────────────────────────────────

/**
 * On screen a report sits in a card; in the PDF its pieces are stacked onto A4
 * pages one by one (see reports/pdf.ts), so the card is left out.
 */
function Sheet({ pdf, children }: { pdf?: boolean; children: ReactNode }) {
  return pdf ? <>{children}</> : <div className="card overflow-hidden">{children}</div>;
}

/** A piece of a report that the PDF export places whole. */
function Block({ children, className = '', repeat, table }: { children: ReactNode; className?: string; repeat?: boolean; table?: boolean }) {
  return (
    <div data-pdf-block="" data-pdf-repeat={repeat ? '' : undefined} data-pdf-table={table ? '' : undefined} className={className}>
      {children}
    </div>
  );
}

function Panel({ title, subtitle, children, className = '' }: { title: string; subtitle?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`card p-4 ${className}`}>
      <h3 className="text-sm font-semibold text-center text-jira-navy">{title}</h3>
      {subtitle && <p className="text-[11px] text-jira-muted text-center mt-0.5">{subtitle}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function ReportBanner({ title, subtitle, pdf }: { title: string; subtitle: string; pdf?: boolean }) {
  return (
    <Block repeat className={`${pdf ? 'rounded-md' : 'rounded-t-md'} px-5 py-4 text-white bg-gradient-to-r from-[#1F4E3D] to-[#2E8B57]`}>
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="text-xs text-white/80 mt-0.5">{subtitle}</p>
    </Block>
  );
}

function IssueTable({ rows, showStatus = true }: { rows: ReportIssueRow[]; showStatus?: boolean }) {
  return (
    <table className="data-table text-xs bg-white">
      <thead>
        <tr>
          <th>Parent</th>
          <th>Key</th>
          <th>Summary</th>
          <th>Type</th>
          <th>Priority</th>
          {showStatus && <th>Status</th>}
          <th>Created</th>
          <th>Assignee</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key}>
            <td className="whitespace-nowrap">{r.parentKey ? <Link to={`/browse/${r.parentKey}`} className="link">{r.parentKey}</Link> : ''}</td>
            <td className="whitespace-nowrap"><Link to={`/browse/${r.key}`} className="link">{r.key}</Link></td>
            <td className="min-w-[240px]">{r.summary}</td>
            <td className="whitespace-nowrap">{typeLabel(r.type)}</td>
            <td className="whitespace-nowrap">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ background: PRIORITY_COLORS[r.priority] }} />
                {priorityLabel(r.priority)}
              </span>
            </td>
            {showStatus && <td className="whitespace-nowrap">{r.statusName}</td>}
            <td className="whitespace-nowrap">{fmtDate(r.createdAt)}</td>
            <td className="whitespace-nowrap">{r.assignee ?? <span className="text-jira-muted">Unassigned</span>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ─── Reports ─────────────────────────────────────────────────────────────────

interface ReportProps { data: ReportData; pdf?: boolean }

function StatusDashboard({ data, pdf }: ReportProps) {
  const statusSlices = useMemo(() => {
    const used: Record<string, number> = {};
    return data.byStatus.map((s) => {
      const shades = CATEGORY_SHADES[s.category] ?? SERIES;
      const i = used[s.category] ?? 0;
      used[s.category] = i + 1;
      return { label: s.name, value: s.count, color: shades[i % shades.length] };
    });
  }, [data.byStatus]);
  const typeSlices = data.byType.map((t, i) => ({ label: typeLabel(t.type), value: t.count, color: SERIES[i % SERIES.length] }));
  const prioritySlices = data.byPriority.map((p) => ({ label: priorityLabel(p.priority), value: p.count, color: PRIORITY_COLORS[p.priority] }));
  const pending = data.pendingByType.map((t, i) => ({ label: typeLabel(t.type), value: t.count, color: SERIES[i % SERIES.length] }));
  const assignees = data.closedByAssignee.map((a, i) => ({ label: a.name, value: a.count, color: SERIES[i % 3] }));

  const cards = [
    { label: 'Project', value: data.project.name },
    { label: 'Report date', value: fmtDate(data.generatedAt) },
    { label: 'Overall status', value: data.summary.overallStatus },
    { label: '% Complete', value: `${data.summary.percentComplete}%` },
  ];
  // The PDF always uses the wide layout, whatever the screen size.
  const cols3 = pdf ? 'grid-cols-3' : 'grid-cols-1 lg:grid-cols-3';

  return (
    <div>
      <Block className="mb-4">
        <h2 className="text-xl font-semibold text-[#1F4E3D]">Monthly Project Status Report</h2>
        <p className="text-xs text-jira-muted mb-4">
          Issue overview for {fmtDate(data.period.from)} – {fmtDate(data.period.to)} · {data.summary.total} issues created in the period
        </p>
        <div className={`grid gap-3 ${pdf ? 'grid-cols-4' : 'grid-cols-2 lg:grid-cols-4'}`}>
          {cards.map((c) => (
            <div key={c.label} className="rounded-md overflow-hidden border border-[#D9A066]">
              <div className="px-3 py-1 text-[11px] font-semibold text-jira-subtle bg-white">{c.label}</div>
              <div className="px-3 py-2 text-center font-semibold bg-[#D9A066] text-[#1F2D27] truncate">{c.value}</div>
            </div>
          ))}
        </div>
      </Block>
      <Block className={`grid ${cols3} gap-4 mb-4`}>
        <Panel title="Issue Status"><Donut slices={statusSlices} /><Legend slices={statusSlices} /></Panel>
        <Panel title="Issue Type"><Donut slices={typeSlices} /><Legend slices={typeSlices} columns={2} /></Panel>
        <Panel title="Priority Breakdown"><Donut slices={prioritySlices} /><Legend slices={prioritySlices} columns={2} /></Panel>
      </Block>
      <Block className={`grid ${cols3} gap-4`}>
        <Panel title="Pending Items" subtitle="Open issues by type"><ColumnChart bars={pending} /></Panel>
        <Panel
          title="Closed by Last Assignee"
          subtitle={`Top ${data.closedByAssignee.length || 14} · last assignee${data.unassignedClosed ? ` · ${data.unassignedClosed} unassigned omitted` : ''}`}
        >
          <HBarChart bars={assignees} />
        </Panel>
        <Panel title="Closed per Month" subtitle="Whole project · 12 months to the end of the period · count on top">
          <MonthlyChart months={data.closedPerMonth} />
        </Panel>
      </Block>
    </div>
  );
}

function IssueTimeline({ data, pdf }: ReportProps) {
  const all = data.longestOpen.flatMap((g) => g.issues);
  const end = new Date(data.period.to).getTime();
  const start = Math.min(...all.map((i) => new Date(i.createdAt).getTime()), end - 86_400_000);
  const span = Math.max(end - start, 1);
  const ticks = Array.from({ length: 5 }, (_, i) => new Date(start + (span * i) / 4));
  const statuses = [...new Set(all.map((i) => i.status))];
  const pad = pdf ? 'bg-white rounded-md px-5 py-3' : 'px-5';

  return (
    <Sheet pdf={pdf}>
      <ReportBanner
        pdf={pdf}
        title="Issue Timeline"
        subtitle={`Top 10 longest open bugs, stories and epics · created ${data.period.from} to ${data.period.to}`}
      />
      <Block className={`${pad} pt-5`}>
        <div className="flex items-end justify-between mb-2">
          <h3 className="font-semibold text-[#1F4E3D]">Longest Open Issues by Type (Top 10 each)</h3>
          <div className="flex gap-3 text-xs">
            {statuses.map((s) => (
              <span key={s} className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm" style={{ background: TIMELINE_COLORS[s] ?? '#B9C2BE' }} />
                {TIMELINE_LABELS[s] ?? humanize(s)}
              </span>
            ))}
          </div>
        </div>
        <div className="flex text-[10px] text-jira-muted border-b border-jira-border pb-1">
          <span className="w-[45%] shrink-0">Issue</span>
          <div className="flex-1 flex justify-between">{ticks.map((t) => <span key={t.getTime()}>{t.toLocaleDateString('en-GB')}</span>)}</div>
        </div>
      </Block>
      {data.longestOpen.map((g) => (
        <Block key={g.group} className={`${pad} pb-3`}>
          <h4 className="text-sm font-semibold text-[#1F4E3D] my-2">Longest Open {GROUP_LABELS[g.group]}</h4>
          {g.issues.length === 0 ? <p className="text-xs text-jira-muted">No open {GROUP_LABELS[g.group].toLowerCase()} in the period.</p> : (
            <div className="space-y-1">
              {g.issues.map((i) => {
                const left = ((new Date(i.createdAt).getTime() - start) / span) * 100;
                return (
                  <div key={i.key} className="flex items-center gap-2 text-xs">
                    <Link
                      to={`/browse/${i.key}`}
                      className="w-[45%] shrink-0 truncate rounded border border-[#E3C9A8] bg-[#FBF6EF] px-2 py-1 hover:bg-[#F5EBDD]"
                      title={`${i.key}: ${i.summary}`}
                    >
                      <span className="font-medium">{i.key}</span>: {i.summary} <span className="text-jira-muted">({i.ageDays}d)</span>
                    </Link>
                    <div className="flex-1 relative h-5 bg-jira-gray rounded-sm">
                      <div
                        className="absolute top-0.5 bottom-0.5 rounded-sm"
                        style={{ left: `${left}%`, right: 0, minWidth: 3, background: TIMELINE_COLORS[i.status] ?? '#B9C2BE' }}
                        title={`${i.statusName} · open ${i.ageDays} days since ${fmtDate(i.createdAt)}`}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Block>
      ))}
    </Sheet>
  );
}

function PriorityAnalysis({ data, pdf }: ReportProps) {
  const slices = data.openByPriority.map((p) => ({ label: priorityLabel(p.priority), value: p.count, color: PRIORITY_COLORS[p.priority] }));
  const urgent = data.openIssues.filter((i) => i.priority === 'HIGHEST' || i.priority === 'HIGH');
  return (
    <Sheet pdf={pdf}>
      <ReportBanner pdf={pdf} title="Priority Breakdown Analysis" subtitle="Open issues only · closed issues are excluded from this analysis" />
      <Block className="px-5 pt-5">
        <Panel title="Open Issues by Priority" className="max-w-xl mx-auto">
          <div className="flex flex-row items-center gap-6 justify-center">
            <Donut slices={slices} size={220} />
            <Legend slices={slices} />
          </div>
        </Panel>
      </Block>
      <Block className="px-5">
        <h3 className="font-semibold text-[#1F4E3D] mt-2">Highest &amp; High Priority — Open Only ({urgent.length})</h3>
        {urgent.length === 0 && <p className="text-sm text-jira-muted mt-2">No open highest or high priority issues.</p>}
      </Block>
      {urgent.length > 0 && <Block table className={`px-5 pb-5 ${pdf ? '' : 'overflow-x-auto'}`}><IssueTable rows={urgent} /></Block>}
    </Sheet>
  );
}

const PAGE_SIZE = 50;

function OpenIssues({ data, pdf }: ReportProps) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(data.openIssues.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const closedPct = pct(data.summary.closed, data.summary.total);
  // The PDF lists every open issue; the screen shows one page at a time.
  const rows = pdf ? data.openIssues : data.openIssues.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);
  return (
    <Sheet pdf={pdf}>
      <ReportBanner
        pdf={pdf}
        title={`Open Issues (${data.openIssues.length})`}
        subtitle={`${data.summary.open} open issues · ${data.period.from} to ${data.period.to} · ${closedPct}% closed overall`}
      />
      {data.openIssues.length === 0 ? <Block className="p-5"><p className="text-sm text-jira-muted">No open issues in the period.</p></Block> : (
        <Block table className={`p-5 ${pdf ? '' : 'overflow-x-auto'}`}><IssueTable rows={rows} /></Block>
      )}
      {!pdf && pages > 1 && (
        <div className="flex items-center justify-end gap-2 px-5 pb-5 text-sm">
          <span className="text-jira-muted">Page {current + 1} of {pages}</span>
          <button type="button" className="btn btn-default" disabled={current === 0} onClick={() => setPage(current - 1)}>Previous</button>
          <button type="button" className="btn btn-default" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>Next</button>
        </div>
      )}
    </Sheet>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'status', label: 'Status dashboard', Component: StatusDashboard },
  { id: 'timeline', label: 'Issue timeline', Component: IssueTimeline },
  { id: 'priority', label: 'Priority analysis', Component: PriorityAnalysis },
  { id: 'open', label: 'Open issues', Component: OpenIssues },
] as const;

/** CSS width the PDF is laid out at; it is scaled to the 190 mm printable width of A4. */
const PDF_WIDTH_PX = 880;

export default function ReportsPage() {
  const { project } = useProject();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [exporting, setExporting] = useState(false);
  const pdfRoot = useRef<HTMLDivElement>(null);
  const exportRunning = useRef(false);
  const tab = TABS.find((t) => t.id === params.get('tab'))?.id ?? 'status';
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const { data, isLoading, error } = useQuery({
    queryKey: ['reports', from, to],
    queryFn: () => api.getReport(from || undefined, to || undefined),
  });

  // Once the off-screen PDF layout has rendered, capture it page by page.
  useEffect(() => {
    // A background refetch changes `data` mid-export; don't start a second one.
    if (!exporting || !data || !pdfRoot.current || exportRunning.current) return;
    exportRunning.current = true;
    const root = pdfRoot.current;
    (async () => {
      try {
        await document.fonts.ready;
        // A timer, not requestAnimationFrame: that one pauses while the tab is in the background.
        await new Promise((r) => setTimeout(r, 50));
        // Loaded on demand: the PDF libraries are large and only needed here.
        const { exportReportPdf } = await import('../reports/pdf');
        await exportReportPdf(root, {
          filename: `${data.project.key}-report-${data.period.from}-to-${data.period.to}.pdf`,
          footer: `JiraTech · ${data.project.name} (${data.project.key}) · ${fmtDate(data.period.from)} – ${fmtDate(data.period.to)} · generated ${new Date().toLocaleString('en-GB')}`,
        });
      } catch (e) {
        toast(`Could not create the PDF: ${errorMessage(e)}`, 'error');
      } finally {
        exportRunning.current = false;
        setExporting(false);
      }
    })();
  }, [exporting, data, toast]);

  const update = (changes: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    setParams(next, { replace: true });
  };

  const presets = [
    { label: 'Last 3 months', months: 3 },
    { label: 'Last 6 months', months: 6 },
    { label: 'Last 12 months', months: 12 },
  ];
  const applyPreset = (months: number) => {
    const end = new Date();
    const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - months + 1, 1));
    update({ from: isoDay(start), to: isoDay(end) });
  };
  const Active = TABS.find((t) => t.id === tab)!.Component;

  return (
    <div>
      <PageHeader
        title="Reports"
        breadcrumbs={project ? `${project.name} · reports` : undefined}
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setExporting(true)} disabled={!data || exporting}>
            {exporting ? 'Creating PDF…' : 'Download PDF'}
          </button>
        }
      >
        <div className="flex flex-wrap items-end gap-3 mt-4">
          <label className="text-xs text-jira-subtle">
            From
            <input type="date" className="input block mt-1" value={from || data?.period.from || ''} max={to || undefined} onChange={(e) => update({ from: e.target.value })} />
          </label>
          <label className="text-xs text-jira-subtle">
            To
            <input type="date" className="input block mt-1" value={to || data?.period.to || ''} min={from || undefined} onChange={(e) => update({ to: e.target.value })} />
          </label>
          {presets.map((p) => (
            <button key={p.label} type="button" className="btn btn-subtle" onClick={() => applyPreset(p.months)}>{p.label}</button>
          ))}
        </div>
      </PageHeader>
      <div className="flex gap-1 border-b border-jira-border mb-5" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => update({ tab: t.id === 'status' ? '' : t.id })}
            className={`px-3 py-2 text-sm font-medium -mb-px border-b-2 ${tab === t.id ? 'border-[#2E8B57] text-[#1F4E3D]' : 'border-transparent text-jira-subtle hover:text-jira-navy'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {isLoading ? <Spinner label="Building reports…" /> : error ? (
        <EmptyState title="Reports unavailable">{errorMessage(error)}</EmptyState>
      ) : data && (
        <div className="bg-[#F3F6F1] -mx-6 px-6 py-5">
          <Active data={data} />
        </div>
      )}

      {/* The full report pack at a fixed A4-proportioned width, rendered off screen while exporting. */}
      {exporting && data && (
        <div ref={pdfRoot} aria-hidden="true" className="fixed top-0 bg-[#F3F6F1]" style={{ left: -20000, width: PDF_WIDTH_PX }}>
          {TABS.map((t) => (
            <div key={t.id} data-pdf-section="">
              <t.Component data={data} pdf />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
