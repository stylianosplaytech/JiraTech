import { IssueTypeIcon, PriorityGlyph } from './Icons';

export const STATUS_LABELS: Record<string, string> = {
  BACKLOG: 'Backlog',
  TO_DO: 'To Do',
  DOING: 'In Progress',
  CLOSED: 'Closed',
};

// Atlassian lozenges: grey = not started, blue = in progress, green = done.
const STATUS_STYLES: Record<string, string> = {
  BACKLOG: 'bg-[#DFE1E6] text-[#42526E]',
  TO_DO: 'bg-[#DFE1E6] text-[#42526E]',
  DOING: 'bg-[#DEEBFF] text-[#0747A6]',
  CLOSED: 'bg-[#E3FCEF] text-[#006644]',
};

const RAG_COLORS: Record<string, string> = {
  GREEN: 'bg-[#36B37E]',
  AMBER: 'bg-[#FFAB00]',
  RED: 'bg-[#DE350B]',
};

export function typeLabel(type: string) {
  const s = type.replace(/_/g, ' ').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Issue type icon, optionally followed by its name. */
export function TypeBadge({ type, showLabel = false }: { type: string; showLabel?: boolean }) {
  if (!showLabel) return <IssueTypeIcon type={type} />;
  return (
    <span className="inline-flex items-center gap-1.5">
      <IssueTypeIcon type={type} />
      <span>{typeLabel(type)}</span>
    </span>
  );
}

export function PriorityIcon({ priority, showLabel = false }: { priority: string; showLabel?: boolean }) {
  if (!showLabel) return <PriorityGlyph priority={priority} />;
  return (
    <span className="inline-flex items-center gap-1.5">
      <PriorityGlyph priority={priority} />
      <span>{priority.charAt(0) + priority.slice(1).toLowerCase()}</span>
    </span>
  );
}

export function RagDot({ status }: { status?: string }) {
  if (!status) return null;
  return (
    <span
      className={`inline-block w-2.5 h-2.5 rounded-full ${RAG_COLORS[status] ?? 'bg-gray-300'}`}
      title={`RAG: ${status.charAt(0) + status.slice(1).toLowerCase()}`}
    />
  );
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`lozenge ${STATUS_STYLES[status] ?? 'bg-[#DFE1E6] text-[#42526E]'}`}>
      {STATUS_LABELS[status] ?? status.replace(/_/g, ' ')}
    </span>
  );
}
