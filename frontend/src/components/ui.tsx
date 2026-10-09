import {
  createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode,
} from 'react';
import { AlertIcon, CheckIcon, XIcon } from './Icons';

// ─── Click-outside / Escape helper ───────────────────────────────────────────

export function useDismiss<T extends HTMLElement>(open: boolean, onClose: () => void) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    // Capture phase + preventDefault so an open popover swallows Escape before an enclosing Modal sees it.
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open, onClose]);
  return ref;
}

// ─── Dropdown menu ───────────────────────────────────────────────────────────

export function Dropdown({
  trigger, children, align = 'left', width = 'w-56',
}: {
  trigger: (props: { open: boolean; toggle: () => void }) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: 'left' | 'right';
  width?: string;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useDismiss<HTMLDivElement>(open, close);
  return (
    <div className="relative inline-block" ref={ref}>
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open && (
        <div className={`popover absolute top-full mt-1 ${align === 'right' ? 'right-0' : 'left-0'} ${width} max-w-[calc(100vw-1rem)]`}>
          {children(close)}
        </div>
      )}
    </div>
  );
}

// ─── Modal ───────────────────────────────────────────────────────────────────

export function Modal({
  title, onClose, children, footer, width = 'max-w-lg',
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-[#091E427A] p-2 pt-4 sm:p-4 sm:pt-[10vh] overflow-y-auto" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className={`w-full ${width} bg-white rounded-[3px] shadow-modal`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 px-4 sm:px-6 pt-5 pb-3">
          <h2 className="text-xl font-medium text-jira-navy">{title}</h2>
          <button type="button" onClick={onClose} className="btn btn-subtle btn-icon" aria-label="Close">
            <XIcon />
          </button>
        </div>
        <div className="px-4 sm:px-6 pb-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 px-4 sm:px-6 py-4 border-t border-jira-border">{footer}</div>}
      </div>
    </div>
  );
}

// ─── Confirm / prompt dialogs (promise-based) ────────────────────────────────

interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
}

interface PromptOptions {
  title: string;
  label: string;
  initial?: string;
  confirmLabel?: string;
}

type DialogState =
  | { kind: 'confirm'; opts: ConfirmOptions; resolve: (v: boolean) => void }
  | { kind: 'prompt'; opts: PromptOptions; resolve: (v: string | null) => void };

const DialogContext = createContext<{
  confirm: (o: ConfirmOptions) => Promise<boolean>;
  prompt: (o: PromptOptions) => Promise<string | null>;
}>({ confirm: async () => false, prompt: async () => null });

function PromptBody({ opts, onDone }: { opts: PromptOptions; onDone: (v: string | null) => void }) {
  const [value, setValue] = useState(opts.initial ?? '');
  return (
    <Modal
      title={opts.title}
      onClose={() => onDone(null)}
      width="max-w-md"
      footer={(
        <>
          <button type="button" className="btn btn-subtle" onClick={() => onDone(null)}>Cancel</button>
          <button type="submit" form="prompt-form" className="btn btn-primary" disabled={!value.trim()}>
            {opts.confirmLabel ?? 'Save'}
          </button>
        </>
      )}
    >
      <form id="prompt-form" onSubmit={(e) => { e.preventDefault(); if (value.trim()) onDone(value.trim()); }}>
        <label className="field-label" htmlFor="prompt-input">{opts.label}</label>
        <input id="prompt-input" autoFocus className="input" value={value} onChange={(e) => setValue(e.target.value)} />
      </form>
    </Modal>
  );
}

export function DialogProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DialogState | null>(null);

  const confirm = useCallback((opts: ConfirmOptions) =>
    new Promise<boolean>((resolve) => setState({ kind: 'confirm', opts, resolve })), []);
  const prompt = useCallback((opts: PromptOptions) =>
    new Promise<string | null>((resolve) => setState({ kind: 'prompt', opts, resolve })), []);

  const finish = (value: boolean | string | null) => {
    if (!state) return;
    (state.resolve as (v: typeof value) => void)(value);
    setState(null);
  };

  return (
    <DialogContext.Provider value={{ confirm, prompt }}>
      {children}
      {state?.kind === 'confirm' && (
        <Modal
          title={(
            <span className="flex items-center gap-2">
              {state.opts.danger && <span className="text-[#DE350B]"><AlertIcon size={20} /></span>}
              {state.opts.title}
            </span>
          )}
          onClose={() => finish(false)}
          width="max-w-md"
          footer={(
            <>
              <button type="button" className="btn btn-subtle" onClick={() => finish(false)}>Cancel</button>
              <button
                type="button"
                autoFocus
                className={`btn ${state.opts.danger ? 'btn-danger' : 'btn-primary'}`}
                onClick={() => finish(true)}
              >
                {state.opts.confirmLabel ?? 'Confirm'}
              </button>
            </>
          )}
        >
          <div className="text-sm text-jira-navy">{state.opts.message}</div>
        </Modal>
      )}
      {state?.kind === 'prompt' && <PromptBody opts={state.opts} onDone={finish} />}
    </DialogContext.Provider>
  );
}

export function useDialogs() {
  return useContext(DialogContext);
}

// ─── Toasts ──────────────────────────────────────────────────────────────────

interface Toast { id: number; message: string; tone: 'success' | 'error' }

const ToastContext = createContext<(message: string, tone?: Toast['tone']) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const show = useCallback((message: string, tone: Toast['tone'] = 'success') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 6000 : 3500);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="fixed bottom-4 inset-x-4 sm:bottom-6 sm:left-6 sm:right-auto z-[60] flex flex-col gap-2">
        {toasts.map((t) => (
          <div key={t.id} className="flex items-start gap-2 bg-white shadow-modal rounded-[3px] px-4 py-3 w-full sm:w-80 text-sm">
            <span className={t.tone === 'error' ? 'text-[#DE350B]' : 'text-[#36B37E]'}>
              {t.tone === 'error' ? <AlertIcon /> : <CheckIcon />}
            </span>
            <span className="flex-1">{t.message}</span>
            <button type="button" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))} className="text-jira-muted hover:text-jira-navy">
              <XIcon size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

// ─── Small building blocks ───────────────────────────────────────────────────

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-jira-muted text-sm py-6">
      <span className="w-4 h-4 border-2 border-jira-border border-t-jira-blue rounded-full animate-spin" />
      {label}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="text-center py-12 px-4">
      <p className="text-base font-medium text-jira-navy">{title}</p>
      {children && <p className="text-sm text-jira-muted mt-1">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function PageHeader({ breadcrumbs, title, actions, children }: {
  breadcrumbs?: ReactNode;
  title: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="mb-6">
      {breadcrumbs && <div className="text-sm text-jira-subtle mb-2">{breadcrumbs}</div>}
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <h1 className="page-title min-w-0 break-words">{title}</h1>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

export function errorMessage(e: unknown) {
  return e instanceof Error ? e.message : 'Something went wrong';
}
