import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type PortalField, type PortalPage } from '../api';
import { RichTextEditor } from '../components/RichText';
import { SelectPicker } from '../components/Pickers';
import Avatar from '../components/Avatar';
import { ChevronRightIcon } from '../components/Icons';
import { EmptyState, Spinner, errorMessage, useToast } from '../components/ui';
import { PortalHero } from './Branding';
import { usePortalBrand, usePortalHome } from './PortalLayout';
import { RequestList } from './PortalHomePage';

function FieldInput({ field, value, onChange }: { field: PortalField; value: string; onChange: (v: string) => void }) {
  const id = `field-${field.key}`;
  const label = (
    <label htmlFor={id} className="field-label">
      {field.name}{field.required && <span className="text-[#DE350B]"> *</span>}
    </label>
  );
  if (field.type === 'SELECT') {
    return (
      <div>
        {label}
        <SelectPicker
          variant="field"
          searchable={field.options.length > 8}
          value={value || undefined}
          onChange={(v) => onChange(v ?? '')}
          allowClear={!field.required}
          placeholder="Choose…"
          clearLabel="None"
          options={field.options.map((o) => ({ id: o, label: o }))}
        />
      </div>
    );
  }
  return (
    <div>
      {label}
      <input
        id={id}
        className="input"
        type={field.type === 'NUMBER' ? 'number' : field.type === 'DATE' ? 'date' : 'text'}
        required={field.required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function RequestForm({ desk, typeId }: { desk: PortalPage; typeId: string }) {
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const type = desk.requestTypes.find((t) => t.id === typeId);
  const [summary, setSummary] = useState('');
  const [description, setDescription] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [onBehalfOf, setOnBehalfOf] = useState<string | undefined>();
  // Shared with the first of the requester's organizations by default; '' keeps it private.
  const [shareWith, setShareWith] = useState<string>(desk.shareWith[0]?.id ?? '');
  const [shareForCustomer, setShareForCustomer] = useState(true);
  const { data: customers } = useQuery({
    queryKey: ['users', 'customers'],
    queryFn: () => api.getUsers(undefined, 'customers'),
    enabled: desk.canRaiseOnBehalf,
  });

  const raise = useMutation({
    mutationFn: () => api.raiseRequest(desk.slug, {
      requestTypeId: typeId,
      summary: summary.trim(),
      description: description || undefined,
      fields,
      onBehalfOfId: onBehalfOf,
      // For someone else, the server picks the customer's organization; for yourself, the one chosen here.
      ...(onBehalfOf
        ? { shareWithOrganization: shareForCustomer }
        : shareWith ? { organizationId: shareWith } : { shareWithOrganization: false }),
    }),
    onSuccess: ({ key }) => {
      queryClient.invalidateQueries({ queryKey: ['portal-requests'] });
      toast(`Request ${key} raised`);
      navigate(`/portal/requests/${key}`);
    },
  });

  if (!type) return <EmptyState title="Request type not found" action={<Link to={`/portal/${desk.slug}`} className="btn btn-default">Back</Link>}>It may have been removed.</EmptyState>;
  const missing = type.fields.some((f) => f.required && !fields[f.key]?.trim());

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); raise.mutate(); }}
      className="card bg-white p-5 sm:p-6 space-y-5 max-w-2xl"
    >
      <div>
        <h2 className="text-lg font-semibold">{type.name}</h2>
        {type.description && <p className="text-jira-subtle mt-1">{type.description}</p>}
      </div>
      {desk.canRaiseOnBehalf && (
        <div>
          <span className="field-label">Raise this request on behalf of</span>
          <SelectPicker
            variant="field"
            value={onBehalfOf}
            onChange={(v) => setOnBehalfOf(v ?? undefined)}
            placeholder="Myself"
            clearLabel="Myself"
            allowClear
            options={(customers ?? []).map((c) => ({ id: c.id, label: c.name, hint: c.email, icon: <Avatar name={c.name} size="xs" /> }))}
          />
          <span className="field-help">For requests that came in by phone or chat. The customer is kept up to date.</span>
        </div>
      )}
      <div>
        <label htmlFor="summary" className="field-label">Summary <span className="text-[#DE350B]">*</span></label>
        <input id="summary" className="input" required minLength={3} maxLength={255} autoFocus value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="A short description of what you need" />
      </div>
      <div>
        <span className="field-label">Description</span>
        <RichTextEditor value={description} onChange={setDescription} mentions={false} placeholder="Add any details that will help us: what happened, what you expected, error messages…" minHeight={140} />
      </div>
      {type.fields.map((f) => (
        <FieldInput key={f.key} field={f} value={fields[f.key] ?? ''} onChange={(v) => setFields((all) => ({ ...all, [f.key]: v }))} />
      ))}
      {onBehalfOf ? (
        <label className="flex items-start gap-2 cursor-pointer">
          <input type="checkbox" className="mt-1" checked={shareForCustomer} onChange={(e) => setShareForCustomer(e.target.checked)} />
          <span>Share with the customer's organization<span className="field-help mt-0">Their colleagues can follow it in the help center.</span></span>
        </label>
      ) : desk.shareWith.length > 0 && (
        <div>
          <span className="field-label">Share with</span>
          <SelectPicker
            variant="field"
            searchable={false}
            value={shareWith || 'private'}
            onChange={(v) => setShareWith(!v || v === 'private' ? '' : v)}
            options={[
              ...desk.shareWith.map((o) => ({ id: o.id, label: o.name, hint: 'Your colleagues can see and follow it' })),
              { id: 'private', label: 'No one', hint: 'Only you and the support team' },
            ]}
          />
        </div>
      )}
      {raise.isError && <div role="alert" className="rounded-[3px] bg-[#FFEBE6] text-[#BF2600] px-3 py-2">{errorMessage(raise.error)}</div>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn btn-primary" disabled={summary.trim().length < 3 || missing || raise.isPending}>
          {raise.isPending ? 'Sending…' : 'Send'}
        </button>
        <Link to={`/portal/${desk.slug}`} className="btn btn-subtle">Cancel</Link>
      </div>
    </form>
  );
}

export default function PortalDeskPage() {
  const { slug = '', typeId } = useParams<{ slug: string; typeId?: string }>();
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: api.me });
  const { data: desk, isLoading, error } = useQuery({ queryKey: ['portal', slug.toLowerCase()], queryFn: () => api.getPortal(slug), retry: false });
  const { data: open } = useQuery({ queryKey: ['portal-requests', 'open', ''], queryFn: () => api.getMyRequests('open') });
  const home = usePortalHome(me);
  usePortalBrand(desk && { slug: desk.slug, name: desk.name, branding: desk.branding });

  if (isLoading) return <Spinner />;
  if (!desk) {
    return (
      <EmptyState title="Help center not found" action={<Link to="/portal" className="btn btn-default">All help centers</Link>}>
        {errorMessage(error)}
      </EmptyState>
    );
  }
  const accent = desk.branding.color ?? undefined;
  const mine = open?.filter((r) => r.portal?.slug === desk.slug) ?? [];

  return (
    <div>
      {(home === '/portal' || typeId) && (
        <nav className="text-sm text-jira-subtle mb-2" aria-label="Breadcrumb">
          {home === '/portal' && <Link to="/portal" className="hover:underline">Help centers</Link>}
          {home === '/portal' && typeId && ' / '}
          {typeId && <Link to={`/portal/${desk.slug}`} className="hover:underline">{desk.name}</Link>}
        </nav>
      )}
      {!typeId && <div className="mb-6"><PortalHero branding={desk.branding} title={desk.name} subtitle={desk.description} /></div>}

      {typeId ? <RequestForm key={typeId} desk={desk} typeId={typeId} /> : (
        <>
          <h2 className="text-base font-semibold mb-3">What can we help you with?</h2>
          {desk.requestTypes.length === 0 && <EmptyState title="Nothing to request yet">This help center doesn't offer any request types yet.</EmptyState>}
          <div className="card bg-white divide-y divide-jira-border max-w-2xl">
            {desk.requestTypes.map((t) => (
              <Link key={t.id} to={`/portal/${desk.slug}/${t.id}`} className="flex items-center gap-4 px-4 py-3 hover:bg-jira-gray">
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-jira-blue" style={accent ? { color: accent } : undefined}>{t.name}</span>
                  {t.description && <span className="block text-sm text-jira-subtle">{t.description}</span>}
                </span>
                <ChevronRightIcon size={16} className="text-jira-muted" />
              </Link>
            ))}
          </div>
          {mine.length > 0 && (
            <section className="mt-8 max-w-2xl">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-base font-semibold">Open requests</h2>
                <Link to="/portal/requests" className="link text-sm">View all</Link>
              </div>
              <RequestList requests={mine.slice(0, 5)} />
            </section>
          )}
        </>
      )}
    </div>
  );
}
