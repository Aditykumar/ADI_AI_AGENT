import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import toast from 'react-hot-toast';

export default function LoginPage() {
  const { login } = useAuth();
  const [form,    setForm]    = useState({ username: '', password: '' });
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    try {
      await login(form.username.trim(), form.password);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center px-4">
      <div className="w-full max-w-sm">

        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 text-3xl mb-4">
            🤖
          </div>
          <h1 className="text-2xl font-bold text-white">AI Testing Agent</h1>
          <p className="text-muted text-sm mt-1">Sign in to start testing</p>
        </div>

        {/* Card */}
        <form onSubmit={handleSubmit}
          className="bg-surface border border-border rounded-2xl p-8 space-y-5 shadow-2xl">

          <div>
            <label className="block text-sm font-medium text-muted mb-1.5">Username</label>
            <input
              type="text" autoComplete="username" required
              value={form.username}
              onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
              className="w-full bg-bg border border-border rounded-xl px-4 py-2.5 text-white
                         placeholder-muted/50 focus:outline-none focus:border-accent transition"
              placeholder="admin"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-muted mb-1.5">Password</label>
            <input
              type="password" autoComplete="current-password" required
              value={form.password}
              onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
              className="w-full bg-bg border border-border rounded-xl px-4 py-2.5 text-white
                         placeholder-muted/50 focus:outline-none focus:border-accent transition"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit" disabled={loading}
            className="w-full bg-accent hover:bg-indigo-500 disabled:opacity-50
                       text-white font-semibold py-2.5 rounded-xl transition">
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>

        <p className="text-center text-muted/60 text-xs mt-6">
          Demo: admin / admin123 · tester / tester123
        </p>
      </div>
    </div>
  );
}
