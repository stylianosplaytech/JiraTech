import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';

export default function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('admin@jiratech.local');
  const [password, setPassword] = useState('admin123');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const { accessToken } = await api.login(email, password);
      localStorage.setItem('token', accessToken);
      navigate('/');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Login failed';
      setError(msg.includes('fetch') || msg.includes('Failed to fetch')
        ? 'Cannot connect to the server. Run "npm run dev" from the JiraTech folder.'
        : msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-jira-navy">
      <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow-xl p-8 w-full max-w-md">
        <h1 className="text-2xl font-bold text-jira-navy mb-1">JiraTech</h1>
        <p className="text-gray-500 text-sm mb-6">Sign in to SPORTS project</p>

        {error && (
          <div className="bg-red-50 text-red-700 px-3 py-2 rounded mb-4 text-sm">{error}</div>
        )}

        <label className="block mb-4">
          <span className="text-sm font-medium text-gray-700">Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 block w-full border border-jira-border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-jira-blue"
          />
        </label>

        <label className="block mb-6">
          <span className="text-sm font-medium text-gray-700">Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 block w-full border border-jira-border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-jira-blue"
          />
        </label>

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-jira-blue text-white py-2 rounded font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? 'Signing in...' : 'Sign in'}
        </button>

        <p className="text-xs text-gray-400 mt-4 text-center">
          Seeded users: admin@jiratech.local, dev@jiratech.local, qa@jiratech.local — password admin123
        </p>
      </form>
    </div>
  );
}
