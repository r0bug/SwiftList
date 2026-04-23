import { useState, type FormEvent } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { api } from '../api/client.js';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string })?.from ?? '/';

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api.login(email, password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof Error && err.message !== 'unauthenticated' ? err.message : 'Invalid email or password');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-950 text-neutral-100">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm space-y-4 bg-neutral-900 border border-neutral-800 rounded-lg p-6"
      >
        <h1 className="text-2xl font-semibold">swiftlist</h1>
        <p className="text-sm text-neutral-400">Sign in to continue.</p>
        <label className="block space-y-1">
          <span className="text-xs uppercase tracking-wide text-neutral-400">Email</span>
          <input
            type="email"
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full bg-neutral-950 border border-neutral-700 rounded px-3 py-2 focus:border-neutral-500 outline-none"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-xs uppercase tracking-wide text-neutral-400">Password</span>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full bg-neutral-950 border border-neutral-700 rounded px-3 py-2 focus:border-neutral-500 outline-none"
          />
        </label>
        {error && <div className="text-sm text-red-400">{error}</div>}
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-neutral-100 text-neutral-950 rounded py-2 font-medium disabled:opacity-60"
        >
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
