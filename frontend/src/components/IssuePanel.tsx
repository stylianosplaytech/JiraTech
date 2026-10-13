import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type UpdateIssuePayload } from '../api';
import { timeAgo } from '../utils';
import { TypeBadge } from './Badges';
import { CopyIcon, XIcon } from './Icons';
import { Spinner, errorMessage, useToast } from './ui';
import { InlineText, InlineTextarea } from './InlineEdit';
import { IssueDetailsFields, StatusDropdown } from './IssueFields';

const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));

/**
 * Quick-edit panel docked to the right of the board: every field of the issue, edited in place, without
 * leaving the board. Clicking another card swaps the issue; Escape or ✕ closes it.
 */
export default function IssuePanel({ issueKey, onClose }: { issueKey: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { data: currentUser } = useQuery({ queryKey: ['me'], queryFn: api.me });
  const { data: issue, isLoading, error } = useQuery({
    queryKey: ['issue', issueKey],
    queryFn: () => api.getIssue(issueKey),
    retry: false,
  });

  useEffect(() => {
    // Popovers inside the panel take Escape first (they preventDefault); text being edited cancels itself.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented && !isTyping(e.target)) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['issue'] });
    queryClient.invalidateQueries({ queryKey: ['history'] });
    queryClient.invalidateQueries({ queryKey: ['search'] });
    queryClient.invalidateQueries({ queryKey: ['board'] });
  };
  const onError = (e: unknown) => toast(errorMessage(e), 'error');
  const update = useMutation({
    mutationFn: (data: UpdateIssuePayload) => api.updateIssue(issue!.id, data),
    onSuccess: refresh,
    onError,
  });
  const transition = useMutation({
    mutationFn: ({ statusId, resolution }: { statusId: string; resolution?: string }) =>
      api.transitionIssue(issue!.id, { statusId }, resolution),
    onSuccess: () => { refresh(); queryClient.invalidateQueries({ queryKey: ['transitions'] }); },
    onError,
  });
  const updateRag = useMutation({ mutationFn: (rag: string) => api.updateRag(issue!.id, rag), onSuccess: refresh, onError });

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/browse/${issueKey}`);
      toast('Link copied');
    } catch {
      toast('Could not copy the link', 'error');
    }
  };

  const canEdit = issue?.permissions?.canEdit ?? false;

  return (
    <aside
      className="fixed inset-y-0 right-0 z-40 w-full sm:w-[460px] bg-white shadow-modal flex flex-col animate-[slide-in_150ms_ease-out]"
      aria-label={`Edit ${issueKey}`}
    >
      <div className="flex items-center gap-2 px-4 sm:px-5 py-3 border-b border-jira-border">
        {issue && <TypeBadge type={issue.type} />}
        <Link to={`/browse/${issue?.key ?? issueKey}`} className="text-sm text-jira-subtle hover:underline" title="Open the full issue page">
          {issue?.key ?? issueKey}
        </Link>
        <span className="ml-auto flex items-center gap-1">
          <Link to={`/browse/${issue?.key ?? issueKey}`} className="btn btn-subtle btn-sm">Open full page</Link>
          <button type="button" onClick={copyLink} className="btn btn-subtle btn-sm btn-icon" title="Copy link"><CopyIcon size={14} /></button>
          <button type="button" onClick={onClose} className="btn btn-subtle btn-sm btn-icon" aria-label="Close" title="Close (Esc)"><XIcon /></button>
        </span>
      </div>

      <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-4">
        {isLoading ? <Spinner /> : !issue ? (
          <p className="text-sm text-jira-muted">{error ? errorMessage(error) : `${issueKey} does not exist or was deleted.`}</p>
        ) : (
          <>
            {!canEdit && (
              <p className="rounded-[3px] bg-jira-blue-light text-[#0747A6] px-3 py-2 mb-3 text-sm" role="status">
                View only: ask a project administrator for member access to change this issue.
              </p>
            )}
            <InlineText
              key={issue.id}
              readOnly={!canEdit}
              value={issue.summary}
              onSave={(summary) => update.mutate({ summary })}
              className="text-xl font-medium leading-tight mx-0"
              inputClassName="text-xl font-medium h-10"
              validate={(v) => (v.length < 3 ? 'Summary must be at least 3 characters' : null)}
            />

            <div className="flex flex-wrap items-center gap-2 mt-3 mb-5">
              <StatusDropdown issue={issue} canEdit={canEdit} pending={transition.isPending} onTransition={(t) => transition.mutate(t)} />
              {issue.resolution && (
                <span className="text-sm text-jira-subtle">
                  Resolution: <span className="text-jira-navy">{issue.resolution === 'COMPLETED' ? 'Done' : 'Rejected'}</span>
                </span>
              )}
              {issue.blocked && <span className="lozenge bg-[#FFEBE6] text-[#BF2600]">Blocked</span>}
            </div>

            <h3 className="text-sm font-semibold text-jira-navy mb-1">Description</h3>
            <div className="mb-5">
              <InlineTextarea
                key={issue.id}
                readOnly={!canEdit}
                value={issue.description ?? ''}
                onSave={(description) => update.mutate({ description })}
                saving={update.isPending}
              />
            </div>

            <h3 className="text-sm font-semibold text-jira-navy mb-1">Details</h3>
            <IssueDetailsFields
              issue={issue}
              canEdit={canEdit}
              currentUserId={currentUser?.id}
              onUpdate={(data) => update.mutate(data)}
              onUpdateRag={(r) => updateRag.mutate(r)}
            />

            <div className="text-xs text-jira-muted mt-4 space-y-0.5">
              {issue.createdAt && <p title={new Date(issue.createdAt).toLocaleString()}>Created {timeAgo(issue.createdAt)}</p>}
              {issue.updatedAt && <p title={new Date(issue.updatedAt).toLocaleString()}>Updated {timeAgo(issue.updatedAt)}</p>}
              <p>
                Comments, attachments and links are on the <Link to={`/browse/${issue.key}`} className="link">full page</Link>.
              </p>
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
