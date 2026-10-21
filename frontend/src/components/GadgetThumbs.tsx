import type { GadgetType } from '../api';

/** Which picture to draw: a kind of gadget, or one way of drawing a chart. */
export type ThumbKind =
  | 'list' | 'count'
  | 'bars' | 'donut' | 'pie' | 'line'
  | 'created' | 'created-line' | 'cvr' | 'cvr-bars'
  | 'progress' | 'stacked' | 'resolution' | 'stale';

const BLUE = '#0052CC';
const RED = '#DE350B';
const GREEN = '#36B37E';
const AMBER = '#FFAB00';
const GRAY = '#DFE1E6';

function Slice({ from, to, r, width, color }: { from: number; to: number; r: number; width: number; color: string }) {
  const C = 2 * Math.PI * r;
  return (
    <circle cx="32" cy="20" r={r} fill="none" stroke={color} strokeWidth={width}
      strokeDasharray={`${(to - from) * C} ${C}`} strokeDashoffset={-from * C} transform="rotate(-90 32 20)" />
  );
}

/** A small drawing of what a gadget (or chart style) looks like. Decorative: the label next to it says what it is. */
export function Thumb({ kind, className = 'w-full h-auto' }: { kind: ThumbKind; className?: string }) {
  return (
    <svg viewBox="0 0 64 40" className={className} aria-hidden="true">
      <rect x="0.5" y="0.5" width="63" height="39" rx="3" fill="#fff" stroke={GRAY} />
      {kind === 'list' && [0, 1, 2, 3].map((i) => (
        <g key={i}>
          <rect x="6" y={7 + i * 8} width="6" height="4" rx="1" fill={[RED, GREEN, BLUE, GREEN][i]} />
          <rect x="15" y={7.5 + i * 8} width={[34, 28, 38, 22][i]} height="3" rx="1.5" fill={GRAY} />
          <rect x="53" y={7.5 + i * 8} width="6" height="3" rx="1.5" fill={[BLUE, AMBER, BLUE, GRAY][i]} />
        </g>
      ))}
      {kind === 'count' && (
        <>
          <text x="32" y="25" textAnchor="middle" fontSize="16" fontWeight="600" fill="#172B4D" fontFamily="system-ui, sans-serif">42</text>
          <rect x="22" y="30" width="20" height="3" rx="1.5" fill={GRAY} />
        </>
      )}
      {kind === 'bars' && [0, 1, 2, 3].map((i) => (
        <g key={i}>
          <rect x="6" y={7 + i * 8} width="14" height="3" rx="1.5" fill={GRAY} />
          <rect x="23" y={6.5 + i * 8} width={[34, 26, 18, 10][i]} height="4" rx="2" fill={[BLUE, GREEN, AMBER, RED][i]} />
        </g>
      ))}
      {kind === 'donut' && (
        <>
          <Slice from={0} to={0.45} r={11} width={7} color={BLUE} />
          <Slice from={0.45} to={0.75} r={11} width={7} color={GREEN} />
          <Slice from={0.75} to={1} r={11} width={7} color={AMBER} />
        </>
      )}
      {kind === 'pie' && (
        <>
          <Slice from={0} to={0.45} r={7} width={14} color={BLUE} />
          <Slice from={0.45} to={0.75} r={7} width={14} color={GREEN} />
          <Slice from={0.75} to={1} r={7} width={14} color={AMBER} />
        </>
      )}
      {kind === 'line' && (
        <polyline points="6,30 16,24 24,27 34,14 44,20 58,9" fill="none" stroke={BLUE} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      )}
      {kind === 'created' && [4, 7, 5, 12, 8, 16, 10, 6].map((h, i) => (
        <rect key={i} x={6 + i * 7} y={34 - h * 1.5} width="4.5" height={h * 1.5} rx="1" fill={BLUE} />
      ))}
      {kind === 'created-line' && (
        <polyline points="6,30 16,24 24,27 34,14 44,20 58,9" fill="none" stroke={BLUE} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      )}
      {kind === 'cvr' && (
        <>
          <polyline points="6,28 16,22 26,26 36,12 46,18 58,10" fill="none" stroke={RED} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          <polyline points="6,31 16,29 26,24 36,25 46,15 58,19" fill="none" stroke={GREEN} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        </>
      )}
      {kind === 'cvr-bars' && [[8, 4], [6, 7], [12, 6], [9, 11], [14, 8]].map(([c, r], i) => (
        <g key={i}>
          <rect x={7 + i * 11} y={34 - c * 1.6} width="4.5" height={c * 1.6} rx="1" fill={RED} />
          <rect x={11.8 + i * 11} y={34 - r * 1.6} width="4.5" height={r * 1.6} rx="1" fill={GREEN} />
        </g>
      ))}
      {kind === 'progress' && (
        <>
          <text x="32" y="20" textAnchor="middle" fontSize="12" fontWeight="600" fill="#172B4D" fontFamily="system-ui, sans-serif">68%</text>
          <rect x="8" y="26" width="48" height="5" rx="2.5" fill={GRAY} />
          <rect x="8" y="26" width="33" height="5" rx="2.5" fill={GREEN} />
          <rect x="41" y="26" width="8" height="5" fill={BLUE} />
        </>
      )}
      {kind === 'stacked' && [[14, 8, 4], [10, 6, 3], [8, 3, 3], [6, 2, 1]].map(([a, b, c], i) => (
        <g key={i}>
          <rect x="6" y={7 + i * 8} width="10" height="3" rx="1.5" fill={GRAY} />
          <rect x="19" y={6.5 + i * 8} width={a * 2.2} height="4" fill={BLUE} />
          <rect x={19 + a * 2.2} y={6.5 + i * 8} width={b * 2.2} height="4" fill={GREEN} />
          <rect x={19 + (a + b) * 2.2} y={6.5 + i * 8} width={c * 2.2} height="4" fill={AMBER} />
        </g>
      ))}
      {kind === 'resolution' && (
        <>
          <text x="32" y="15" textAnchor="middle" fontSize="9" fontWeight="600" fill="#172B4D" fontFamily="system-ui, sans-serif">3.2d</text>
          {[6, 12, 9, 5, 2].map((h, i) => (
            <rect key={i} x={9 + i * 10} y={34 - h * 1.3} width="7" height={h * 1.3} rx="1" fill={BLUE} />
          ))}
        </>
      )}
      {kind === 'stale' && [0, 1, 2, 3].map((i) => (
        <g key={i}>
          <rect x="6" y={7 + i * 8} width="6" height="4" rx="1" fill={[BLUE, GREEN, RED, BLUE][i]} />
          <rect x="15" y={7.5 + i * 8} width={[28, 22, 32, 18][i]} height="3" rx="1.5" fill={GRAY} />
          <rect x={[44, 47, 50, 52][i]} y={7.5 + i * 8} width={[14, 11, 8, 6][i]} height="3" rx="1.5" fill={AMBER} />
        </g>
      ))}
      {(kind === 'line' || kind === 'created' || kind === 'created-line' || kind === 'cvr' || kind === 'cvr-bars' || kind === 'resolution') && (
        <line x1="5" y1="34.5" x2="59" y2="34.5" stroke={GRAY} />
      )}
      {(kind === 'donut' || kind === 'pie') && (
        <>
          <rect x="46" y="12" width="12" height="3" rx="1.5" fill={BLUE} />
          <rect x="46" y="19" width="9" height="3" rx="1.5" fill={GREEN} />
          <rect x="46" y="26" width="6" height="3" rx="1.5" fill={AMBER} />
        </>
      )}
    </svg>
  );
}

/** What a gadget type looks like in its default style. */
export const TYPE_THUMB: Record<GadgetType, ThumbKind> = {
  FILTER_RESULTS: 'list',
  FILTER_COUNT: 'count',
  BREAKDOWN: 'bars',
  TREND: 'created',
  CREATED_VS_RESOLVED: 'cvr',
  PROGRESS: 'progress',
  STACKED: 'stacked',
  RESOLUTION_TIME: 'resolution',
  STALE: 'stale',
};

/** Pick one of several options, each shown as a small picture with a label. */
export function ThumbChoice<T extends string>({ label, value, options, onChange, columns = 3 }: {
  label: string;
  value: T;
  options: { value: T; label: string; thumb: ThumbKind; hint?: string }[];
  onChange: (v: T) => void;
  columns?: number;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="grid gap-2" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={o.hint}
            onClick={() => onChange(o.value)}
            className={`rounded-[3px] border p-1.5 text-center transition-colors ${active ? 'border-jira-blue bg-jira-blue-light' : 'border-jira-border hover:bg-jira-gray'}`}
          >
            <Thumb kind={o.thumb} />
            <span className={`block mt-1 text-xs leading-tight ${active ? 'font-semibold text-jira-blue' : 'text-jira-navy'}`}>{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
