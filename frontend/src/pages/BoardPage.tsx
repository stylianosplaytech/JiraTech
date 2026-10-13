import { useCallback, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import type { BoardData, Issue } from '../api';
import { useProject } from '../project';
import { SearchIcon } from '../components/Icons';
import Avatar from '../components/Avatar';
import BoardCard, { type CardEdit } from '../components/BoardCard';
import IssuePanel from '../components/IssuePanel';
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

/** The board with one card changed in place. */
function withIssue(board: BoardData, id: string, patch: Partial<Issue>): BoardData {
  return { columns: board.columns.map((c) => ({ ...c, issues: c.issues.map((i) => (i.id === id ? { ...i, ...patch } : i)) })) };
}

export default function BoardPage() {
  const { project, projectKey } = useProject();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [filter, setFilter] = useState('');
  const [onlyMine, setOnlyMine] = useState(false);
  const [dragging, setDragging] = useState<{ issue: Issue; from: string } | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [pendingDone, setPendingDone] = useState<{ issue: Issue; to: Column } | null>(null);
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: api.me });
  const { data, isLoading } = useQuery({ queryKey: ['board'], queryFn: () => api.getBoard() });
  // What this user may do here: cards of a view-only project don't offer editing.
  const { data: projectDetail } = useQuery({
    queryKey: ['project', projectKey],
    queryFn: () => api.getProject(projectKey!),
    enabled: !!projectKey,
  });
  const canEdit = projectDetail?.permissions.canEdit ?? false;
  const showRag = projectDetail?.strictHierarchy !== false;

  // The card open in the quick-edit panel lives in the URL, so it survives a reload and Back closes it.
  const [params, setParams] = useSearchParams();
  const openKey = params.get('issue');
  const openIssue = useCallback((key: string | null) => {
    setParams((p) => { const next = new URLSearchParams(p); if (key) next.set('issue', key); else next.delete('issue'); return next; }, { replace: !!openKey });
  }, [setParams, openKey]);
  const closePanel = useCallback(() => openIssue(null), [openIssue]);

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

  /** Edits a card in place straight away and puts it back if the server refuses. */
  const optimistic = <T,>(fn: (vars: T) => Promise<unknown>, patch: (vars: T) => { issue: Issue; preview: Partial<Issue> }) => ({
    mutationFn: fn,
    onMutate: async (vars: T) => {
      await queryClient.cancelQueries({ queryKey: ['board'] });
      const previous = queryClient.getQueryData<BoardData>(['board']);
      const { issue, preview } = patch(vars);
      if (previous) queryClient.setQueryData(['board'], withIssue(previous, issue.id, preview));
      return { previous };
    },
    onError: (e: unknown, vars: T, ctx?: { previous?: BoardData }) => {
      if (ctx?.previous) queryClient.setQueryData(['board'], ctx.previous);
      toast(`${patch(vars).issue.key} was not changed: ${errorMessage(e)}`, 'error');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['board'] });
      queryClient.invalidateQueries({ queryKey: ['issue'] });
      queryClient.invalidateQueries({ queryKey: ['history'] });
      queryClient.invalidateQueries({ queryKey: ['search'] });
    },
  });
  const edit = useMutation(optimistic(
    ({ issue, data }: { issue: Issue } & CardEdit) => api.updateIssue(issue.id, data),
    ({ issue, preview }) => ({ issue, preview }),
  ));
  const rag = useMutation(optimistic(
    ({ issue, ragStatus }: { issue: Issue; ragStatus: string }) => api.updateRag(issue.id, ragStatus),
    ({ issue, ragStatus }) => ({ issue, preview: { ragStatus } }),
  ));

  const transitionTo = (issue: Issue, statusId: string, resolution?: string) => {
    const to = data?.columns.find((c) => c.statusId === statusId);
    if (to) move.mutate({ issue, to, resolution });
  };

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
          <span className="hidden md:inline text-xs text-jira-muted ml-auto">
            {canEdit
              ? 'Click a card to edit it · click its priority or avatar to change them · right-click for quick actions · drag to change status'
              : 'Click a card to see its details'}
          </span>
        </div>
      </PageHeader>

      {isLoading ? <Spinner /> : (
        <div className={`grid gap-2 items-start overflow-x-auto pb-2 max-sm:snap-x max-sm:snap-mandatory ${openKey ? 'xl:mr-[460px]' : ''}`} style={{ gridTemplateColumns: `repeat(${Math.max(data?.columns.length ?? 4, 1)}, minmax(200px, 1fr))` }}>
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
                    <BoardCard
                      key={issue.id}
                      issue={issue}
                      canEdit={canEdit}
                      showRag={showRag}
                      me={me}
                      selected={openKey === issue.key}
                      dragging={dragging?.issue.id === issue.id}
                      onOpen={() => openIssue(issue.key)}
                      onEdit={(e) => edit.mutate({ issue, ...e })}
                      onRag={(ragStatus) => rag.mutate({ issue, ragStatus })}
                      onTransition={(statusId, resolution) => transitionTo(issue, statusId, resolution)}
                      onHover={() => prefetchTransitions(issue)}
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('text/plain', issue.key);
                        setDragging({ issue, from: col.statusId });
                      }}
                      onDragEnd={endDrag}
                    />
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

      {openKey && <IssuePanel issueKey={openKey} onClose={closePanel} />}

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
