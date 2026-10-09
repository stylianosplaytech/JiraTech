import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import type { BoardData, Issue } from '../api';
import { useProject } from '../project';
import { PriorityIcon, RagDot, TypeBadge } from '../components/Badges';
import { SearchIcon } from '../components/Icons';
import Avatar from '../components/Avatar';
import { Modal, PageHeader, Spinner, errorMessage, useToast } from '../components/ui';

type Column = BoardData['columns'][number];

interface MoveRequest { issue: Issue; to: Column; resolution?: string }

const transitionsKey = (issue: Issue) => ['transitions', issue.id, issue.workflowStatus?.id];

/** The board with `issue` moved to the top of `to`, as the server will have it after the transition. */
function withMove(board: BoardData, { issue, to, resolution }: MoveRequest): BoardData {
  const moved: Issue = {
    ...issue,
    status: to.status,
    workflowStatus: { id: to.statusId, name: to.name, category: to.status },
    resolution: to.status === 'CLOSED' ? resolution : undefined,
  };
  return {
    columns: board.columns.map((c) => {
      const rest = c.issues.filter((i) => i.id !== issue.id);
      return c.statusId === to.statusId ? { ...c, issues: [moved, ...rest] } : { ...c, issues: rest };
    }),
  };
}

export default function BoardPage() {
  const { project } = useProject();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [filter, setFilter] = useState('');
  const [onlyMine, setOnlyMine] = useState(false);
  const [dragging, setDragging] = useState<{ issue: Issue; from: string } | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [pendingDone, setPendingDone] = useState<{ issue: Issue; to: Column } | null>(null);
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: api.me });
  const { data, isLoading } = useQuery({ queryKey: ['board'], queryFn: () => api.getBoard() });

  // Where the dragged card may go, per the project's workflow (usually already prefetched on hover).
  const { data: allowed } = useQuery({
    queryKey: dragging ? transitionsKey(dragging.issue) : ['transitions', 'none'],
    queryFn: () => api.getTransitions(dragging!.issue.id),
    enabled: !!dragging,
    staleTime: 60_000,
  });
  const prefetchTransitions = (issue: Issue) =>
    queryClient.prefetchQuery({ queryKey: transitionsKey(issue), queryFn: () => api.getTransitions(issue.id), staleTime: 60_000 });

  const move = useMutation({
    mutationFn: ({ issue, to, resolution }: MoveRequest) => api.transitionIssue(issue.id, { statusId: to.statusId }, resolution),
    // Move the card straight away; put it back if the server refuses.
    onMutate: async (req) => {
      await queryClient.cancelQueries({ queryKey: ['board'] });
      const previous = queryClient.getQueryData<BoardData>(['board']);
      if (previous) queryClient.setQueryData(['board'], withMove(previous, req));
      return { previous };
    },
    onError: (e, req, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(['board'], ctx.previous);
      toast(`${req.issue.key} was not moved: ${errorMessage(e)}`, 'error');
    },
    onSuccess: (_issue, req) => toast(`${req.issue.key} moved to ${req.to.name}`),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['board'] });
      queryClient.invalidateQueries({ queryKey: ['transitions'] });
      queryClient.invalidateQueries({ queryKey: ['issue'] });
      queryClient.invalidateQueries({ queryKey: ['history'] });
      queryClient.invalidateQueries({ queryKey: ['search'] });
    },
  });

  const q = filter.trim().toLowerCase();
  const visible = (issues: Issue[]) =>
    issues.filter((i) =>
      (!q || i.summary.toLowerCase().includes(q) || i.key.toLowerCase().includes(q))
      && (!onlyMine || i.assignee?.id === me?.id));

  /** null while the allowed moves are still loading: the server checks the move anyway. */
  const canDropOn = (col: Column) => {
    if (!dragging || col.statusId === dragging.from) return false;
    return allowed ? allowed.some((s) => s.id === col.statusId) : null;
  };

  const endDrag = () => { setDragging(null); setOver(null); };

  const drop = (col: Column) => {
    if (!dragging) return;
    const { issue, from } = dragging;
    endDrag();
    if (col.statusId === from) return;
    if (canDropOn(col) === false) {
      toast(`${issue.key} can't move from ${issue.workflowStatus?.name ?? 'its status'} to ${col.name}`, 'error');
      return;
    }
    // Done statuses need a resolution.
    if (col.status === 'CLOSED') setPendingDone({ issue, to: col });
    else move.mutate({ issue, to: col });
  };

  const finishDone = (resolution: string) => {
    if (!pendingDone) return;
    move.mutate({ ...pendingDone, resolution });
    setPendingDone(null);
  };

  return (
    <div>
      <PageHeader
        breadcrumbs={project && (
          <>
            <Link to="/projects" className="hover:underline">Projects</Link> / <Link to={`/projects/${project.key}`} className="hover:underline">{project.name}</Link>
          </>
        )}
        title={`${project?.key ?? ''} board`}
        actions={<Link to="/search" className="btn btn-default">View all issues</Link>}
      >
        <div className="flex items-center gap-3 mt-4">
          <div className="relative w-56">
            <SearchIcon size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-jira-muted pointer-events-none" />
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search this board" className="input h-8 pl-8" />
          </div>
          {me && (
            <button
              type="button"
              onClick={() => setOnlyMine(!onlyMine)}
              className={`btn btn-sm ${onlyMine ? 'bg-jira-blue-light text-jira-blue' : 'btn-subtle'}`}
              aria-pressed={onlyMine}
            >
              <Avatar name={me.name} size="xs" /> Only my issues
            </button>
          )}
          <span className="hidden md:inline text-xs text-jira-muted ml-auto">Drag a card to another column to change its status</span>
        </div>
      </PageHeader>

      {isLoading ? <Spinner /> : (
        <div className="grid gap-2 items-start overflow-x-auto pb-2 max-sm:snap-x max-sm:snap-mandatory" style={{ gridTemplateColumns: `repeat(${Math.max(data?.columns.length ?? 4, 1)}, minmax(200px, 1fr))` }}>
          {data?.columns.map((col) => {
            const doneColumn = col.status === 'CLOSED';
            const issues = visible(col.issues);
            const droppable = canDropOn(col);
            const isSource = dragging?.from === col.statusId;
            const isOver = over === col.statusId && droppable !== false && !isSource;
            const state = !dragging || isSource
              ? 'bg-jira-gray border-transparent'
              : droppable === false
                ? 'bg-jira-gray border-transparent opacity-50'
                : isOver
                  ? 'bg-jira-blue-light border-jira-blue'
                  : 'bg-jira-gray border-jira-focus border-dashed';
            return (
              <div
                key={col.statusId}
                className={`rounded-[3px] min-h-[300px] border-2 transition-colors snap-start ${state}`}
                onDragOver={(e) => {
                  if (!dragging || isSource || droppable === false) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  if (over !== col.statusId) setOver(col.statusId);
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null) && over === col.statusId) setOver(null);
                }}
                onDrop={(e) => { e.preventDefault(); drop(col); }}
              >
                <div className="px-3 pt-3 pb-2 text-xs font-semibold uppercase text-jira-subtle">
                  {col.name} <span className="ml-1 font-normal">{issues.length}</span>
                  {dragging && droppable === false && !isSource && <span className="block normal-case font-normal mt-0.5">Not allowed by the workflow</span>}
                </div>
                <div className="px-2 pb-2 space-y-1.5">
                  {issues.map((issue) => (
                    <Link
                      key={issue.id}
                      to={`/browse/${issue.key}`}
                      draggable
                      onMouseEnter={() => prefetchTransitions(issue)}
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('text/plain', issue.key);
                        setDragging({ issue, from: col.statusId });
                      }}
                      onDragEnd={endDrag}
                      className={`block bg-white rounded-[3px] shadow-card p-3 hover:bg-[#FAFBFC] transition-colors cursor-grab active:cursor-grabbing ${
                        dragging?.issue.id === issue.id ? 'opacity-40' : ''}`}
                    >
                      <p className="leading-snug text-jira-navy mb-2 line-clamp-3">{issue.summary}</p>
                      {issue.components && issue.components.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-2">
                          {issue.components.slice(0, 3).map((c) => (
                            <span key={c.component.id} className="lozenge bg-jira-gray-hover text-jira-subtle normal-case font-semibold">{c.component.name}</span>
                          ))}
                        </div>
                      )}
                      <div className="flex items-center gap-1.5">
                        <TypeBadge type={issue.type} />
                        <span className={`text-xs font-medium text-jira-subtle ${issue.status === 'CLOSED' ? 'line-through' : ''}`}>{issue.key}</span>
                        {issue.blocked && <span className="lozenge bg-[#FFEBE6] text-[#BF2600]">Blocked</span>}
                        <span className="ml-auto flex items-center gap-1.5">
                          <RagDot status={issue.ragStatus === 'GREEN' ? undefined : issue.ragStatus} />
                          <PriorityIcon priority={issue.priority} />
                          {issue.assignee
                            ? <Avatar name={issue.assignee.name} size="xs" />
                            : <span className="w-5 h-5 rounded-full border border-dashed border-jira-muted" title="Unassigned" />}
                        </span>
                      </div>
                    </Link>
                  ))}
                  {issues.length === 0 && (
                    <p className="text-xs text-jira-muted text-center py-6">
                      {dragging && droppable !== false && !isSource ? 'Drop here' : doneColumn ? 'Nothing done in the last 14 days' : 'No issues'}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {pendingDone && (
        <Modal
          title={`Move ${pendingDone.issue.key} to ${pendingDone.to.name}`}
          onClose={() => setPendingDone(null)}
          footer={
            <>
              <button type="button" className="btn btn-subtle" onClick={() => setPendingDone(null)}>Cancel</button>
              <button type="button" className="btn btn-default" onClick={() => finishDone('REJECTED')}>Won't do</button>
              <button type="button" className="btn btn-primary" onClick={() => finishDone('COMPLETED')} autoFocus>Done</button>
            </>
          }
        >
          <p className="text-sm text-jira-navy">{pendingDone.issue.summary}</p>
          <p className="text-sm text-jira-muted mt-2">Choose a resolution: was the work completed, or was it rejected?</p>
        </Modal>
      )}
    </div>
  );
}
