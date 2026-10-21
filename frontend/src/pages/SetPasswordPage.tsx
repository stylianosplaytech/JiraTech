import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { errorMessage, Spinner } from '../components/ui';
import { AuthShell } from './LoginPage';

const MIN_PASSWORD = 8;

/** /set-password?token=… — the link in a welcome or "forgot password" email: the person chooses a password and is logged in. */
export default function SetPasswordPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const link = useQuery({ queryKey: ['password-link', token], queryFn: () => api.getPasswordLink(token), enabled: !!token, retry: false });

  const tooShort = password.length < MIN_PASSWORD;
  const mismatch = confirm.length > 0 && confirm !== password;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (tooShort || password !== confirm) return;
    setSaving(true);
    setError('');
    try {
      const { accessToken, user } = await api.setPassword(token, password);
      localStorage.setItem('token', accessToken);
      queryClient.clear();
      queryClient.setQueryData(['me'], user);
      navigate(user.role === 'CUSTOMER' ? '/portal' : '/');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const card = 'bg-white rounded-[3px] shadow-modal px-10 py-8 w-full max-w-[400px]';
  if (!token || link.isError) {
    return (
      <AuthShell>
        <div className={card}>
          <h1 className="text-base font-semibold text-center mb-3">This link doesn't work</h1>
          <p className="text-jira-subtle text-center mb-6">
            {token ? errorMessage(link.error) : 'The link is incomplete. Open it straight from the email.'}
          </p>
          <Link to="/forgot-password" className="btn btn-primary w-full h-10 mb-2">Get a new link</Link>
          <Link to="/login" className="btn btn-subtle w-full h-10">Go to log in</Link>
        </div>
      </AuthShell>
    );
  }
  if (!link.data) return <AuthShell><Spinner /></AuthShell>;

  return (
    <AuthShell>
      <form onSubmit={handleSubmit} className={card}>
        <h1 className="text-base font-semibold text-center mb-1">{link.data.welcome ? `Welcome, ${link.data.name}` : 'Choose a new password'}</h1>
        <p className="text-jira-subtle text-center mb-6">
          {link.data.welcome ? 'Choose a password for' : 'For'} <strong className="text-jira-navy">{link.data.email}</strong>
        </p>

        {error && <div role="alert" className="rounded-[3px] bg-[#FFEBE6] text-[#BF2600] px-3 py-2 mb-4">{error}</div>}

        {/* Lets password managers save the new password against the right account. */}
        <input type="email" autoComplete="username" value={link.data.email} readOnly hidden />
        <label className="block mb-4">
          <span className="field-label">New password</span>
          <input type="password" autoComplete="new-password" required autoFocus value={password} onChange={(e) => setPassword(e.target.value)} className="input" />
          <span className="field-help">At least {MIN_PASSWORD} characters.</span>
        </label>
        <label className="block mb-6">
          <span className="field-label">Confirm password</span>
          <input type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} className="input" aria-invalid={mismatch} />
          {mismatch && <span className="field-error">The passwords don't match</span>}
        </label>

        <button type="submit" disabled={saving || tooShort || password !== confirm} className="btn btn-primary w-full h-10">
          {saving ? 'Saving…' : link.data.customer ? 'Save and open the help center' : 'Save and log in'}
        </button>
      </form>
    </AuthShell>
  );
}
