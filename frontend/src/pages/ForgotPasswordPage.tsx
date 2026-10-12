import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api } from '../api';
import { errorMessage } from '../components/ui';
import { AuthShell } from './LoginPage';

/** /forgot-password — emails a link to choose a new password (the same set-password page as welcome emails). */
export default function ForgotPasswordPage() {
  // The login page passes on what was typed there.
  const typed = (useLocation().state as { email?: string } | null)?.email;
  const [email, setEmail] = useState(typed ?? '');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    setError('');
    try {
      await api.forgotPassword(email.trim());
      setSentTo(email.trim());
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSending(false);
    }
  }

  const card = 'bg-white rounded-[3px] shadow-modal px-10 py-8 w-full max-w-[400px]';
  if (sentTo) {
    return (
      <AuthShell>
        <div className={card}>
          <h1 className="text-base font-semibold text-center mb-3">Check your email</h1>
          <p className="text-jira-subtle text-center mb-2">
            If <strong className="text-jira-navy break-all">{sentTo}</strong> has a JiraTech account, we've sent it a link to choose a new password.
          </p>
          <p className="text-jira-muted text-xs text-center mb-6">The link works for 60 minutes. Nothing arrived? Check your spam folder, or ask your administrator.</p>
          <Link to="/login" className="btn btn-default w-full h-10">Back to log in</Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <form onSubmit={handleSubmit} className={card}>
        <h1 className="text-base font-semibold text-center mb-1">Forgot your password?</h1>
        <p className="text-jira-subtle text-center mb-6">Enter the email you log in with and we'll send you a link to choose a new one.</p>

        {error && <div role="alert" className="rounded-[3px] bg-[#FFEBE6] text-[#BF2600] px-3 py-2 mb-4">{error}</div>}

        <label className="block mb-6">
          <span className="field-label">Email</span>
          <input type="email" autoComplete="username" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} className="input" placeholder="you@company.com" />
        </label>

        <button type="submit" disabled={sending || !email.trim()} className="btn btn-primary w-full h-10">
          {sending ? 'Sending…' : 'Send link'}
        </button>
        <p className="text-center mt-4"><Link to="/login" className="link text-sm">Back to log in</Link></p>
      </form>
    </AuthShell>
  );
}
