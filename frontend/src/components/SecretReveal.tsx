import { useState } from 'react';
import { CheckIcon, CopyIcon } from './Icons';
import { Modal } from './ui';

/** Shows a secret that can never be read again (an API token, a webhook signing secret) with a copy button. */
export default function SecretReveal({ title, intro, label, secret, onClose }: {
  title: string;
  intro: string;
  label: string;
  secret: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const copy = () => navigator.clipboard.writeText(secret).then(() => setCopied(true), () => undefined);
  return (
    <Modal
      title={title}
      onClose={onClose}
      width="max-w-xl"
      footer={<button type="button" className="btn btn-primary" onClick={onClose}>Done</button>}
    >
      <p className="text-sm mb-3">{intro}</p>
      <label className="field-label" htmlFor="revealed-secret">{label}</label>
      <div className="flex gap-2">
        <input id="revealed-secret" readOnly className="input font-mono text-xs" value={secret} onFocus={(e) => e.currentTarget.select()} />
        <button type="button" className="btn btn-default shrink-0" onClick={copy}>
          {copied ? <><CheckIcon size={14} /> Copied</> : <><CopyIcon size={14} /> Copy</>}
        </button>
      </div>
    </Modal>
  );
}
