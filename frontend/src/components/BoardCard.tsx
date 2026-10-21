import { useEffect, useRef, useState, type DragEvent, type MouseEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, type Issue, type UpdateIssuePayload } from '../api';
import { PriorityIcon, RagDot, StatusBadge, TypeBadge } from './Badges';
import { AlertIcon, CheckIcon, CopyIcon, EditIcon, MoreIcon, SearchIcon } from './Icons';
import { FloatingPopover, type PopoverAnchor } from './ui';
import { PRIORITIES, RAG_BUTTON, priorityLabel, transitionOptions } from './IssueFields';
import Avatar from './Avatar';

/** A change made from the card, with how the card should look until the server confirms it. */
export interface CardEdit { data: UpdateIssuePayload; preview: Partial<Issue> }

type Open = { kind: 'menu' | 'assignee' | 'priority'; anchor: PopoverAnchor } | null;

const rectOf = (e: { currentTarget: Element }) => e.currentTarget.getBoundingClientRect();

/**
 * A board card whose fields edit in place: the priority and avatar open pickers, the summary edits inline,
 * ⋯ or right-click opens quick actions, and a click opens the full quick-edit panel.
 */
export default function BoardCard({
  issue, canEdit, showRag, me, selected, dragging, onOpen, onEdit, onRag, onTransition, onDragStart, onDragEnd, onHover,
}: {
  issue: Issue;
  canEdit: boolean;
  showRag: boolean;
  me?: { id: string; name: string };
  selected: boolean;
  dragging: boolean;
  onOpen: () => void;
  onEdit: (edit: CardEdit) => void;
  onRag: (rag: string) => void;
  onTransition: (statusId: string, resolution?: string) => void;
  onDragStart: (e: DragEvent) => void;
  onDragEnd: () => void;
  onHover: () => void;
}) {
  const [open, setOpen] = useState<Open>(null);
  const [editingSummary, setEditingSummary] = useState(false);
  const close = () => setOpen(null);

  const assign = (user: { id: string; name: string } | null) => {
    close();
    if ((user?.id ?? null) === (issue.assignee?.id ?? null)) return;
    onEdit({ data: { assigneeId: user?.id ?? '' }, preview: { assignee: user ?? undefined } });
  };
  const setPriority = (priority: string) => {
    close();
    if (priority !== issue.priority) onEdit({ data: { priority }, preview: { priority } });
  };

  return (
    <div
      role="button"
      tabIndex={0}
      draggable={!editingSummary && !open}
      aria-label={`${issue.key} ${issue.summary}`}
      onMouseEnter={onHover}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={(e) => {
        if (editingSummary) return;
        // Ctrl/⌘-click keeps the familiar "open in a new tab".
        if (e.metaKey || e.ctrlKey) window.open(`/browse/${issue.key}`, '_blank');
        else onOpen();
      }}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter') { e.preventDefault(); onOpen(); }
        if (canEdit && e.key === 'F2') { e.preventDefault(); setEditingSummary(true); }
      }}
      onContextMenu={(e) => { e.preventDefault(); setOpen({ kind: 'menu', anchor: { x: e.clientX, y: e.clientY } }); }}
      className={`group relative block bg-white rounded-[3px] shadow-card p-3 hover:bg-[#FAFBFC] transition-colors cursor-pointer
        focus:outline-none focus-visible:ring-2 focus-visible:ring-jira-focus
        ${selected ? 'ring-2 ring-jira-blue' : ''} ${dragging ? 'opacity-40' : ''}`}
    >
      {!editingSummary && (
        <div
          className={`absolute top-1.5 right-1.5 flex rounded-[3px] bg-white shadow-sm
            ${open?.kind === 'menu' ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100'}`}
        >
          {canEdit && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setEditingSummary(true); }}
              className="btn btn-subtle btn-sm btn-icon"
              aria-label={`Edit the summary of ${issue.key}`}
              title="Edit summary (F2)"
            >
              <EditIcon size={14} />
            </button>
          )}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setOpen(open?.kind === 'menu' ? null : { kind: 'menu', anchor: rectOf(e) }); }}
            className="btn btn-subtle btn-sm btn-icon"
            aria-label={`Actions for ${issue.key}`}
            title="Quick actions (or right-click the card)"
          >
            <MoreIcon size={16} />
          </button>
        </div>
      )}

      {editingSummary
        ? <SummaryEditor value={issue.summary} onDone={(summary) => {
          setEditingSummary(false);
          if (summary && summary !== issue.summary) onEdit({ data: { summary }, preview: { summary } });
        }} />
        : (
          <p className="leading-snug text-jira-navy mb-2 line-clamp-3">
            {issue.summary}
          </p>
        )}

      {issue.components && issue.components.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {issue.components.slice(0, 3).map((c) => (
            <span key={c.component.id} className="lozenge bg-jira-gray-hover text-jira-subtle normal-case font-semibold">{c.component.name}</span>
          ))}
        </div>
      )}
      <div className="flex items-center gap-1.5">
        <TypeBadge type={issue.type} />
        <Link
          to={`/browse/${issue.key}`}
          onClick={(e) => e.stopPropagation()}
          draggable={false}
          className={`text-xs font-medium text-jira-subtle hover:underline ${issue.status === 'CLOSED' ? 'line-through' : ''}`}
          title="Open the full issue page"
        >
          {issue.key}
        </Link>
        {issue.blocked && <span className="lozenge bg-[#FFEBE6] text-[#BF2600]">Blocked</span>}
        <span className="ml-auto flex items-center gap-0.5">
          <RagDot status={issue.ragStatus === 'GREEN' ? undefined : issue.ragStatus} />
          <CardButton
            disabled={!canEdit}
            label={`Priority: ${priorityLabel(issue.priority)}${canEdit ? ' (click to change)' : ''}`}
            onClick={(e) => setOpen({ kind: 'priority', anchor: rectOf(e) })}
          >
            <PriorityIcon priority={issue.priority} />
          </CardButton>
          <CardButton
            disabled={!canEdit}
            label={`${issue.assignee ? `Assignee: ${issue.assignee.name}` : 'Unassigned'}${canEdit ? ' (click to change)' : ''}`}
            onClick={(e) => setOpen({ kind: 'assignee', anchor: rectOf(e) })}
          >
            {issue.assignee
              ? <Avatar name={issue.assignee.name} size="xs" />
              : <span className="block w-5 h-5 rounded-full border border-dashed border-jira-muted" />}
          </CardButton>
        </span>
      </div>

      {open?.kind === 'priority' && (
        <FloatingPopover anchor={open.anchor} onClose={close} width={180} align="right">
          <div className="menu-heading">Priority</div>
          {PRIORITIES.map((p) => (
            <button key={p} type="button" className={`menu-item ${p === issue.priority ? 'bg-jira-blue-light/60' : ''}`} onClick={() => setPriority(p)}>
              <PriorityIcon priority={p} /> <span className="flex-1">{priorityLabel(p)}</span>
              {p === issue.priority && <CheckIcon size={14} className="text-jira-blue" />}
            </button>
          ))}
        </FloatingPopover>
      )}
      {open?.kind === 'assignee' && (
        <FloatingPopover anchor={open.anchor} onClose={close} width={260} align="right">
          <AssigneeList current={issue.assignee?.id} me={me} onPick={assign} />
        </FloatingPopover>
      )}
      {open?.kind === 'menu' && (
        <FloatingPopover anchor={open.anchor} onClose={close} width={250} align="right">
          <QuickActions
            issue={issue}
            canEdit={canEdit}
            showRag={showRag}
            me={me}
            onDone={close}
            onOpen={onOpen}
            onEditSummary={() => setEditingSummary(true)}
            onAssign={assign}
            onPriority={setPriority}
            onRag={onRag}
            onBlocked={(blocked) => onEdit({ data: { blocked }, preview: { blocked } })}
            onTransition={onTransition}
            onPickAssignee={(anchor) => setOpen({ kind: 'assignee', anchor })}
          />
        </FloatingPopover>
      )}
    </div>
  );
}

/** A small hit area on the card that edits one field (and never opens the card or starts a drag). */
function CardButton({ children, label, disabled, onClick }: {
  children: ReactNode;
  label: string;
  disabled: boolean;
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
}) {
  if (disabled) return <span className="p-0.5" title={label}>{children}</span>;
  return (
    <button
      type="button"
      draggable={false}
      onClick={(e) => { e.stopPropagation(); onClick(e); }}
      onKeyDown={(e) => e.stopPropagation()}
      className="p-0.5 rounded-full hover:bg-jira-gray-hover hover:ring-2 hover:ring-jira-gray-hover focus-visible:ring-2 focus-visible:ring-jira-focus outline-none"
      title={label}
      aria-label={label}
    >
      {children}
    </button>
  );
}

function SummaryEditor({ value, onDone }: { value: string; onDone: (v: string | null) => void }) {
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { ref.current?.select(); }, []);
  const save = () => onDone(draft.trim().length >= 3 ? draft.trim() : null);
  return (
    <div className="mb-2" onClick={(e) => e.stopPropagation()}>
      <textarea
        ref={ref}
        rows={3}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save(); }
          if (e.key === 'Escape') { e.preventDefault(); onDone(null); }
        }}
        className="input py-1 resize-none leading-snug"
        aria-label="Summary"
      />
      <p className="text-[11px] text-jira-muted mt-0.5">
        {draft.trim().length < 3 ? 'At least 3 characters' : 'Enter to save · Esc to cancel'}
      </p>
    </div>
  );
}

function AssigneeList({ current, me, onPick }: {
  current?: string;
  me?: { id: string; name: string };
  onPick: (user: { id: string; name: string } | null) => void;
}) {
  const [query, setQuery] = useState('');
  const { data: users = [] } = useQuery({ queryKey: ['users'], queryFn: () => api.getUsers() });
  const q = query.trim().toLowerCase();
  const filtered = users.filter((u) => !q || u.name.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q));
  return (
    <>
      <div className="px-2 pb-1 pt-1">
        <div className="relative">
          <SearchIcon size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-jira-muted" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && filtered[0]) { e.preventDefault(); onPick(filtered[0]); } }}
            placeholder="Search people…"
            className="input h-8 pl-7"
          />
        </div>
      </div>
      <div className="max-h-64 overflow-y-auto">
        {!q && me && me.id !== current && (
          <button type="button" className="menu-item text-jira-blue" onClick={() => onPick(me)}>
            <Avatar name={me.name} size="xs" /> Assign to me
          </button>
        )}
        {!q && current && (
          <button type="button" className="menu-item" onClick={() => onPick(null)}>
            <span className="w-5 h-5 rounded-full border border-dashed border-jira-muted" /> <span className="text-jira-muted">Unassigned</span>
          </button>
        )}
        {filtered.map((u) => (
          <button key={u.id} type="button" className={`menu-item ${u.id === current ? 'bg-jira-blue-light/60' : ''}`} onClick={() => onPick(u)}>
            <Avatar name={u.name} size="xs" />
            <span className="truncate flex-1">{u.name}</span>
            {u.id === current && <CheckIcon size={14} className="text-jira-blue" />}
          </button>
        ))}
        {filtered.length === 0 && <div className="px-3 py-2 text-sm text-jira-muted">No matches</div>}
      </div>
    </>
  );
}

function QuickActions({
  issue, canEdit, showRag, me, onDone, onOpen, onEditSummary, onAssign, onPriority, onRag, onBlocked, onTransition, onPickAssignee,
}: {
  issue: Issue;
  canEdit: boolean;
  showRag: boolean;
  me?: { id: string; name: string };
  onDone: () => void;
  onOpen: () => void;
  onEditSummary: () => void;
  onAssign: (user: { id: string; name: string } | null) => void;
  onPriority: (p: string) => void;
  onRag: (rag: string) => void;
  onBlocked: (blocked: boolean) => void;
  onTransition: (statusId: string, resolution?: string) => void;
  onPickAssignee: (anchor: PopoverAnchor) => void;
}) {
  const { data: transitions } = useQuery({
    queryKey: ['transitions', issue.id, issue.workflowStatus?.id],
    queryFn: () => api.getTransitions(issue.id),
    enabled: canEdit,
    staleTime: 60_000,
  });
  const run = (fn: () => void) => () => { onDone(); fn(); };
  const copyLink = () => navigator.clipboard.writeText(`${window.location.origin}/browse/${issue.key}`).catch(() => undefined);

  return (
    <>
      <button type="button" className="menu-item" onClick={run(onOpen)}><EditIcon size={14} /> Edit all fields…</button>
      {canEdit && <button type="button" className="menu-item" onClick={run(onEditSummary)}><EditIcon size={14} /> Edit summary <Kbd>F2</Kbd></button>}
      <Link to={`/browse/${issue.key}`} className="menu-item" onClick={onDone}><span className="w-3.5" /> Open issue page</Link>
      <button type="button" className="menu-item" onClick={run(copyLink)}><CopyIcon size={14} /> Copy link</button>

      {canEdit && (
        <>
          <div className="menu-heading border-t border-jira-border mt-1 pt-2">Move to</div>
          {!transitions && <p className="px-3 py-1 text-xs text-jira-muted">Loading…</p>}
          {transitions?.length === 0 && <p className="px-3 py-1 text-xs text-jira-muted">No moves out of this status</p>}
          {transitions && transitionOptions(transitions).map((o) => (
            <button key={o.key} type="button" className="menu-item justify-between" onClick={run(() => onTransition(o.statusId, o.resolution))}>
              <StatusBadge status={o.category} name={o.label} />
              {o.hint && <span className="text-xs text-jira-muted">{o.hint}</span>}
            </button>
          ))}

          <div className="menu-heading border-t border-jira-border mt-1 pt-2">Assignee</div>
          {me && issue.assignee?.id !== me.id && (
            <button type="button" className="menu-item" onClick={() => onAssign(me)}><Avatar name={me.name} size="xs" /> Assign to me</button>
          )}
          <button type="button" className="menu-item" onClick={(e) => onPickAssignee(e.currentTarget.getBoundingClientRect())}>
            <span className="w-5 h-5 rounded-full border border-dashed border-jira-muted" /> Assign to someone…
          </button>
          {issue.assignee && <button type="button" className="menu-item" onClick={() => onAssign(null)}><span className="w-5" /> Unassign</button>}

          <div className="menu-heading border-t border-jira-border mt-1 pt-2">Priority</div>
          <div className="flex gap-1 px-3 pb-1">
            {PRIORITIES.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => onPriority(p)}
                title={priorityLabel(p)}
                aria-label={`Priority ${priorityLabel(p)}`}
                aria-pressed={p === issue.priority}
                className={`flex-1 flex justify-center py-1 rounded-[3px] border-2 ${p === issue.priority ? 'border-jira-blue bg-jira-blue-light' : 'border-transparent hover:bg-jira-gray-hover'}`}
              >
                <PriorityIcon priority={p} />
              </button>
            ))}
          </div>

          {showRag && (
            <>
              <div className="menu-heading border-t border-jira-border mt-1 pt-2">RAG</div>
              <div className="flex gap-1 px-3 pb-1">
                {(['GREEN', 'AMBER', 'RED'] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={run(() => onRag(r))}
                    className={`flex-1 px-2 py-0.5 rounded-[3px] text-xs font-semibold border-2 ${(issue.ragStatus ?? 'GREEN') === r ? 'border-jira-navy' : 'border-transparent opacity-60 hover:opacity-100'} ${RAG_BUTTON[r]}`}
                  >
                    {priorityLabel(r)}
                  </button>
                ))}
              </div>
            </>
          )}

          <button type="button" className="menu-item border-t border-jira-border mt-1" onClick={run(() => onBlocked(!issue.blocked))}>
            <AlertIcon size={14} />
            {issue.blocked ? 'Remove the Blocked flag' : 'Flag as blocked'}
          </button>
        </>
      )}
    </>
  );
}

function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="ml-auto text-[10px] text-jira-muted border border-jira-border rounded px-1">{children}</kbd>;
}
