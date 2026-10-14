import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type ApiTokenAccess } from '../api';
import { timeAgo } from '../utils';
import SecretReveal from '../components/SecretReveal';
import { PlusIcon, TrashIcon } from '../components/Icons';
import { Modal, PageHeader, Spinner, errorMessage, useDialogs, useToast } from '../components/ui';

const EXPIRY = [
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: '365', label: '1 year' },
  { value: '', label: 'No expiry' },
];

/** /settings/api-tokens — personal tokens for scripts and integrations; each acts as its owner. */
export default function ApiTokensPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { confirm } = useDialogs();
  const { data: tokens, isLoading, error } = useQuery({ queryKey: ['api-tokens'], queryFn: api.getApiTokens });
  const [form, setForm] = useState<{ name: string; access: ApiTokenAccess; expiresInDays: string } | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => api.createApiToken({
      name: form!.name.trim(),
      access: form!.access,
      expiresInDays: form!.expiresInDays ? Number(form!.expiresInDays) : undefined,
    }),
    onSuccess: (t) => {
      queryClient.invalidateQueries({ queryKey: ['api-tokens'] });
      setForm(null);
      setCreated(t.token);
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api.revokeApiToken(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['api-tokens'] }); toast('Token revoked'); },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="API tokens"
        actions={(
          <button type="button" className="btn btn-primary" onClick={() => setForm({ name: '', access: 'READ', expiresInDays: '90' })}>
            <PlusIcon size={14} /> Create token
          </button>
        )}
      />
      <p className="text-jira-subtle mb-4 max-w-3xl">
        Tokens let scripts and tools use the JiraTech API as you, with the same project access you have. Send one as{' '}
        <code className="text-xs">Authorization: Bearer jt_…</code>. A read-only token can only make GET requests. Treat tokens like
        passwords: each is shown once, when it is created.
      </p>
      <div className="card p-4">
        {isLoading ? <Spinner /> : error ? <p className="field-error">{errorMessage(error)}</p> : !tokens?.length ? (
          <p className="text-jira-muted text-sm">You have no API tokens.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead><tr><th>Name</th><th>Token</th><th>Access</th><th>Last used</th><th>Expires</th><th /></tr></thead>
              <tbody>
                {tokens.map((t) => {
                  const expired = !!t.expiresAt && new Date(t.expiresAt).getTime() <= Date.now();
                  return (
                    <tr key={t.id}>
                      <td className="font-medium">{t.name}</td>
                      <td className="font-mono text-xs text-jira-subtle">{t.prefix}…</td>
                      <td>{t.access === 'WRITE' ? 'Read and write' : 'Read only'}</td>
                      <td className="text-jira-subtle whitespace-nowrap">{t.lastUsedAt ? timeAgo(t.lastUsedAt) : 'Never'}</td>
                      <td className={`whitespace-nowrap ${expired ? 'text-[#DE350B]' : 'text-jira-subtle'}`}>
                        {t.expiresAt ? (expired ? 'Expired' : new Date(t.expiresAt).toLocaleDateString()) : 'Never'}
                      </td>
                      <td className="text-right">
                        <button
                          type="button"
                          className="btn btn-subtle btn-sm btn-icon"
                          aria-label={`Revoke ${t.name}`}
                          onClick={async () => {
                            if (await confirm({ title: `Revoke ${t.name}?`, message: 'Anything using this token stops working immediately.', confirmLabel: 'Revoke', danger: true })) revoke.mutate(t.id);
                          }}
                        >
                          <TrashIcon size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {form && (
        <Modal
          title="Create API token"
          onClose={() => setForm(null)}
          footer={(
            <>
              <button type="button" className="btn btn-subtle" onClick={() => setForm(null)}>Cancel</button>
              <button type="button" className="btn btn-primary" disabled={!form.name.trim() || create.isPending} onClick={() => create.mutate()}>
                {create.isPending ? 'Creating…' : 'Create token'}
              </button>
            </>
          )}
        >
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (form.name.trim()) create.mutate(); }}>
            <div>
              <label className="field-label" htmlFor="token-name">Name</label>
              <input id="token-name" autoFocus className="input" maxLength={80} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Nightly report script" />
            </div>
            <div>
              <label className="field-label" htmlFor="token-access">Access</label>
              <select id="token-access" className="input" value={form.access} onChange={(e) => setForm({ ...form, access: e.target.value as ApiTokenAccess })}>
                <option value="READ">Read only (GET requests)</option>
                <option value="WRITE">Read and write (create and change issues as you)</option>
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="token-expiry">Expires after</label>
              <select id="token-expiry" className="input" value={form.expiresInDays} onChange={(e) => setForm({ ...form, expiresInDays: e.target.value })}>
                {EXPIRY.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </form>
        </Modal>
      )}

      {created && (
        <SecretReveal
          title="Your new API token"
          intro="Copy it now: for your security it cannot be shown again. If you lose it, revoke it and create a new one."
          label="Token"
          secret={created}
          onClose={() => setCreated(null)}
        />
      )}
    </div>
  );
}
