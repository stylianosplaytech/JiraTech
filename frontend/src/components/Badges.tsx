const TYPE_COLORS: Record<string, string> = {
  FEATURE_EPIC: 'bg-purple-100 text-purple-800',
  BAU_EPIC: 'bg-orange-100 text-orange-800',
  RELEASE_EPIC: 'bg-blue-100 text-blue-800',
  EPIC: 'bg-indigo-100 text-indigo-800',
  STORY: 'bg-green-100 text-green-800',
  DEFECT: 'bg-red-100 text-red-800',
  TASK: 'bg-yellow-100 text-yellow-800',
  RELEASE_CANDIDATE: 'bg-cyan-100 text-cyan-800',
  CODE: 'bg-teal-100 text-teal-800',
  BUG_FIX: 'bg-rose-100 text-rose-800',
  ANALYSIS: 'bg-slate-100 text-slate-800',
  TEST_RUN: 'bg-lime-100 text-lime-800',
  DEPLOYMENT: 'bg-violet-100 text-violet-800',
};

const PRIORITY_COLORS: Record<string, string> = {
  HIGHEST: 'text-red-600',
  HIGH: 'text-orange-600',
  MEDIUM: 'text-yellow-600',
  LOW: 'text-blue-600',
  LOWEST: 'text-gray-500',
};

const RAG_COLORS: Record<string, string> = {
  GREEN: 'bg-green-500',
  AMBER: 'bg-amber-500',
  RED: 'bg-red-500',
};

export function TypeBadge({ type }: { type: string }) {
  const color = TYPE_COLORS[type] ?? 'bg-gray-100 text-gray-800';
  const label = type.replace(/_/g, ' ');
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${color}`}>
      {label}
    </span>
  );
}

export function PriorityIcon({ priority }: { priority: string }) {
  return (
    <span className={`text-xs font-bold ${PRIORITY_COLORS[priority] ?? ''}`} title={priority}>
      {priority === 'HIGHEST' ? '▲▲' : priority === 'HIGH' ? '▲' : priority === 'LOW' ? '▼' : '·'}
    </span>
  );
}

export function RagDot({ status }: { status?: string }) {
  if (!status) return null;
  return (
    <span
      className={`inline-block w-2.5 h-2.5 rounded-full ${RAG_COLORS[status] ?? 'bg-gray-300'}`}
      title={`RAG: ${status}`}
    />
  );
}

export function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    BACKLOG: 'bg-gray-200 text-gray-700',
    TO_DO: 'bg-blue-100 text-blue-800',
    DOING: 'bg-yellow-100 text-yellow-800',
    CLOSED: 'bg-green-100 text-green-800',
  };
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${colors[status] ?? ''}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}
