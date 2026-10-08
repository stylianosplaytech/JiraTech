import {
  forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode,
} from 'react';
import { EditorContent, ReactRenderer, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import Mention from '@tiptap/extension-mention';
import type { SuggestionKeyDownProps, SuggestionProps } from '@tiptap/suggestion';
import DOMPurify from 'dompurify';
import { useQueryClient } from '@tanstack/react-query';
import { api, type User } from '../api';
import Avatar from './Avatar';
import { useDialogs } from './ui';

/** Same rule as the server: editor HTML starts with a block element; anything else is legacy plain text. */
export function looksLikeHtml(value: string | null | undefined) {
  return !!value && /^\s*<(p|h[1-3]|ul|ol|blockquote|pre|hr)[\s>]/i.test(value);
}

const escape = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/** Load legacy plain text into the editor as paragraphs. */
function toEditorHtml(value: string) {
  if (!value) return '';
  if (looksLikeHtml(value)) return value;
  return value.split(/\n{2,}/).map((para) => `<p>${escape(para).replace(/\n/g, '<br>')}</p>`).join('');
}

// ─── Read-only rendering ─────────────────────────────────────────────────────

/** Renders stored rich text safely. Legacy plain text keeps its line breaks and @email highlighting. */
export function RichTextView({ value, empty }: { value: string | null | undefined; empty?: ReactNode }) {
  const html = useMemo(() => (looksLikeHtml(value)
    ? DOMPurify.sanitize(value!, {
      ALLOWED_TAGS: ['p', 'br', 'strong', 'b', 'em', 'i', 's', 'u', 'code', 'pre', 'blockquote', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'hr', 'a', 'span'],
      ALLOWED_ATTR: ['href', 'target', 'rel', 'data-type', 'data-id', 'data-label', 'class', 'start'],
    })
    : null), [value]);

  if (!value) return <>{empty ?? null}</>;
  if (html !== null) return <div className="rich-text" dangerouslySetInnerHTML={{ __html: html }} />;
  const parts = value.split(/(@[\w.+-]+@[\w-]+(?:\.[\w-]+)+)/g);
  return (
    <div className="rich-text whitespace-pre-wrap">
      {parts.map((p, i) => (i % 2 === 1 ? <span key={i} className="mention">{p}</span> : <span key={i}>{p}</span>))}
    </div>
  );
}

// ─── Mention suggestions ─────────────────────────────────────────────────────

interface MentionListHandle {
  onKeyDown: (props: SuggestionKeyDownProps) => boolean;
}

const MentionList = forwardRef<MentionListHandle, SuggestionProps<User>>((props, ref) => {
  const [active, setActive] = useState(0);
  useEffect(() => setActive(0), [props.items]);
  const pick = (i: number) => {
    const u = props.items[i];
    if (u) props.command({ id: u.id, label: u.name });
  };
  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (!props.items.length) return false;
      if (event.key === 'ArrowDown') { setActive((a) => (a + 1) % props.items.length); return true; }
      if (event.key === 'ArrowUp') { setActive((a) => (a - 1 + props.items.length) % props.items.length); return true; }
      if (event.key === 'Enter' || event.key === 'Tab') { pick(active); return true; }
      return false;
    },
  }));
  if (!props.items.length) {
    return <div className="popover w-64 px-3 py-2 text-sm text-jira-muted">No matching people</div>;
  }
  return (
    <div className="popover w-72" role="listbox" aria-label="Mention someone">
      <div className="menu-heading">Mention someone</div>
      {props.items.map((u, i) => (
        <button
          key={u.id}
          type="button"
          role="option"
          aria-selected={i === active}
          onMouseDown={(e) => e.preventDefault()}
          onMouseEnter={() => setActive(i)}
          onClick={() => pick(i)}
          className={`menu-item ${i === active ? 'bg-jira-blue-light/60' : ''}`}
        >
          <Avatar name={u.name} size="xs" />
          <span className="truncate">{u.name}</span>
          <span className="ml-auto text-xs text-jira-muted truncate">{u.email}</span>
        </button>
      ))}
    </div>
  );
});
MentionList.displayName = 'MentionList';

function mentionExtension(loadUsers: () => Promise<User[]>) {
  return Mention.configure({
    HTMLAttributes: { class: 'mention' },
    renderText: ({ node }) => `@${node.attrs.label ?? node.attrs.id}`,
    renderHTML: ({ options, node }) => [
      'span',
      { ...options.HTMLAttributes, 'data-type': 'mention', 'data-id': node.attrs.id, 'data-label': node.attrs.label },
      `@${node.attrs.label ?? node.attrs.id}`,
    ],
    suggestion: {
      items: async ({ query }) => {
        const q = query.toLowerCase();
        return (await loadUsers()).filter((u) => `${u.name} ${u.email}`.toLowerCase().includes(q)).slice(0, 6);
      },
      render: () => {
        let renderer: ReactRenderer<MentionListHandle, SuggestionProps<User>> | null = null;
        let host: HTMLDivElement | null = null;
        const place = (props: SuggestionProps<User>) => {
          const rect = props.clientRect?.();
          if (!rect || !host) return;
          host.style.left = `${rect.left + window.scrollX}px`;
          host.style.top = `${rect.bottom + window.scrollY + 4}px`;
        };
        return {
          onStart: (props) => {
            renderer = new ReactRenderer(MentionList, { props, editor: props.editor });
            host = document.createElement('div');
            host.style.position = 'absolute';
            host.style.zIndex = '70';
            host.appendChild(renderer.element);
            document.body.appendChild(host);
            place(props);
          },
          onUpdate: (props) => { renderer?.updateProps(props); place(props); },
          onKeyDown: (props) => {
            if (props.event.key === 'Escape') { host?.remove(); host = null; return true; }
            return renderer?.ref?.onKeyDown(props) ?? false;
          },
          onExit: () => { host?.remove(); host = null; renderer?.destroy(); renderer = null; },
        };
      },
    },
  });
}

// ─── Editor ──────────────────────────────────────────────────────────────────

function ToolbarButton({ onClick, active, label, children }: { onClick: () => void; active?: boolean; label: string; children: ReactNode }) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={`h-7 min-w-[28px] px-1.5 rounded-[3px] text-sm ${active ? 'bg-jira-blue-light text-jira-blue' : 'text-jira-subtle hover:bg-jira-gray-hover hover:text-jira-navy'}`}
    >
      {children}
    </button>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const { prompt } = useDialogs();
  const setLink = async () => {
    const previous = editor.getAttributes('link').href as string | undefined;
    const url = await prompt({ title: previous ? 'Edit link' : 'Add link', label: 'URL (leave empty to remove)', initial: previous ?? 'https://', confirmLabel: 'Apply' });
    if (url === null) return;
    if (!url.trim() || url === 'https://') editor.chain().focus().unsetLink().run();
    else editor.chain().focus().extendMarkRange('link').setLink({ href: url.trim() }).run();
  };
  const sep = <span className="w-px h-5 bg-jira-border mx-1" />;
  return (
    <div className="flex flex-wrap items-center gap-0.5 px-1.5 py-1 border-b border-jira-border bg-white rounded-t-[3px]">
      <ToolbarButton label="Bold (Ctrl+B)" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}><b>B</b></ToolbarButton>
      <ToolbarButton label="Italic (Ctrl+I)" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}><i>I</i></ToolbarButton>
      <ToolbarButton label="Strikethrough" active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()}><s>S</s></ToolbarButton>
      <ToolbarButton label="Inline code" active={editor.isActive('code')} onClick={() => editor.chain().focus().toggleCode().run()}><span className="font-mono text-xs">{'</>'}</span></ToolbarButton>
      {sep}
      <ToolbarButton label="Heading" active={editor.isActive('heading', { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}><span className="font-semibold">H</span></ToolbarButton>
      <ToolbarButton label="Bulleted list" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}>•≡</ToolbarButton>
      <ToolbarButton label="Numbered list" active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}>1.</ToolbarButton>
      <ToolbarButton label="Quote" active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()}>❝</ToolbarButton>
      <ToolbarButton label="Code block" active={editor.isActive('codeBlock')} onClick={() => editor.chain().focus().toggleCodeBlock().run()}><span className="font-mono text-xs">{'{ }'}</span></ToolbarButton>
      {sep}
      <ToolbarButton label="Link" active={editor.isActive('link')} onClick={() => void setLink()}>🔗</ToolbarButton>
      <ToolbarButton label="Mention someone (@)" onClick={() => editor.chain().focus().insertContent(' @').run()}>@</ToolbarButton>
    </div>
  );
}

export interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  /** Ctrl/Cmd+Enter */
  onSubmit?: () => void;
  /** Escape (when no mention list is open) */
  onCancel?: () => void;
  minHeight?: number;
  onFocus?: () => void;
  compact?: boolean;
}

/** Rich-text editor with a formatting toolbar and @name mentions. Emits '' for an empty document. */
export function RichTextEditor({
  value, onChange, placeholder, autoFocus, onSubmit, onCancel, minHeight = 120, onFocus, compact,
}: RichTextEditorProps) {
  const queryClient = useQueryClient();
  const callbacks = useRef({ onSubmit, onCancel, onChange, onFocus });
  callbacks.current = { onSubmit, onCancel, onChange, onFocus };

  const loadUsers = useMemo(
    () => () => queryClient.fetchQuery({ queryKey: ['users'], queryFn: () => api.getUsers(), staleTime: 60_000 }),
    [queryClient],
  );

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] } }),
      Link.configure({ openOnClick: false, autolink: true, HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer nofollow' } }),
      Placeholder.configure({ placeholder: placeholder ?? '' }),
      mentionExtension(loadUsers),
    ],
    content: toEditorHtml(value),
    autofocus: autoFocus ? 'end' : false,
    editorProps: {
      attributes: { class: 'rich-text rich-text-editor', role: 'textbox', 'aria-multiline': 'true', 'aria-label': placeholder ?? 'Editor' },
      handleKeyDown: (_view, event) => {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && callbacks.current.onSubmit) {
          callbacks.current.onSubmit();
          return true;
        }
        if (event.key === 'Escape' && callbacks.current.onCancel) {
          callbacks.current.onCancel();
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: e }) => callbacks.current.onChange(e.isEmpty ? '' : e.getHTML()),
    onFocus: () => callbacks.current.onFocus?.(),
  });

  // Reset when the parent clears the value (e.g. after posting a comment).
  useEffect(() => {
    if (editor && value === '' && !editor.isEmpty) editor.commands.clearContent();
  }, [editor, value]);

  if (!editor) return null;
  return (
    <div className="rounded-[3px] border-2 border-jira-border bg-white focus-within:border-jira-focus transition-colors">
      {!compact && <Toolbar editor={editor} />}
      <div style={{ minHeight: compact ? undefined : minHeight }} className="px-3 py-2 cursor-text" onClick={() => editor.commands.focus()}>
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
