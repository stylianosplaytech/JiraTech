import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api';

export default function LoginPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const { accessToken } = await api.login(email, password);
      localStorage.setItem('token', accessToken);
      queryClient.clear();
      navigate('/');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Login failed';
      setError(msg.includes('fetch')
        ? 'Can\'t reach the server. Start it with "npm run dev" in the JiraTech folder.'
        : msg === 'Invalid credentials' ? 'Incorrect email or password.' : msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#FAFBFC] px-4">
      <div className="flex items-center gap-2 mb-8">
        <svg width="32" height="32" viewBox="0 0 24 24" aria-hidden="true">
          <defs>
            <linearGradient id="login-g" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#2684FF" />
              <stop offset="1" stopColor="#0052CC" />
            </linearGradient>
          </defs>
          <path d="M12 2 22 12 12 22 2 12Z" fill="url(#login-g)" />
          <path d="M12 7.5 16.5 12 12 16.5 7.5 12Z" fill="white" />
        </svg>
        <span className="text-2xl font-semibold text-jira-navy">JiraTech</span>
      </div>

      <form onSubmit={handleSubmit} className="bg-white rounded-[3px] shadow-modal px-10 py-8 w-full max-w-[400px]">
        <h1 className="text-base font-semibold text-center text-jira-subtle mb-6">Log in to continue</h1>

        {error && (
          <div role="alert" className="rounded-[3px] bg-[#FFEBE6] text-[#BF2600] px-3 py-2 mb-4">{error}</div>
        )}

        <label className="block mb-4">
          <span className="field-label">Email</span>
          <input type="email" autoComplete="username" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} className="input" placeholder="you@company.com" />
        </label>
        <label className="block mb-6">
          <span className="field-label">Password</span>
          <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className="input" />
        </label>

        <button type="submit" disabled={loading} className="btn btn-primary w-full h-10">
          {loading ? 'Logging in…' : 'Log in'}
        </button>
      </form>

      <p className="text-xs text-jira-muted mt-6 text-center max-w-[400px]">
        Development accounts: admin@jiratech.local, dev@jiratech.local, qa@jiratech.local — see backend/prisma/seed.ts for the password.
      </p>
    </div>
  );
}
