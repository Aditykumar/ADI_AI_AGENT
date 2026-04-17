import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { useAuth, withAuth } from '../contexts/AuthContext';
import api from '../lib/api';

const STATUS_COLORS = {
  PASS: 'text-pass bg-pass/10',
  FAIL: 'text-fail bg-fail/10',
  WARN: 'text-warn bg-warn/10',
  running: 'text-indigo-400 bg-indigo-400/10',
  failed:  'text-fail bg-fail/10',
};

function ScoreRing({ score }) {
  const r   = 20, c = 24, dash = 2 * Math.PI * r;
  const offset = dash * (1 - (score || 0) / 100);
  const color  = score >= 80 ? '#22c55e' : score >= 60 ? '#f59e0b' : '#ef4444';
  return (
    <svg width="48" height="48" viewBox="0 0 48 48">
      <circle cx={c} cy={c} r={r} fill="none" stroke="#334155" strokeWidth="4" />
      <circle cx={c} cy={c} r={r} fill="none" stroke={color} strokeWidth="4"
        strokeDasharray={dash} strokeDashoffset={offset}
        strokeLinecap="round" transform="rotate(-90 24 24)" />
      <text x={c} y={c+4} textAnchor="middle" fill={color} fontSize="11" fontWeight="700">
        {score ?? '?'}
      </text>
    </svg>
  );
}

function Dashboard() {
  const { user, logout } = useAuth();
  const router           = useRouter();
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      const { data } = await api.get('/api/reports');
      setReports(data.reports);
    } catch (_) {
      toast.error('Could not load reports');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function deleteReport(id) {
    if (!confirm('Delete this report?')) return;
    await api.delete(`/api/reports/${id}`);
    setReports(r => r.filter(x => x.id !== id));
    toast.success('Report deleted');
  }

  return (
    <div className="min-h-screen bg-bg">

      {/* Nav */}
      <nav className="border-b border-border bg-surface px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-xl">🤖</span>
          <span className="font-bold text-white">AI Testing Agent</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-muted text-sm">
            {user?.name} <span className="text-xs bg-border px-2 py-0.5 rounded-full ml-1">{user?.role}</span>
          </span>
          <Link href="/test"
            className="bg-accent hover:bg-indigo-500 text-white text-sm px-4 py-2 rounded-xl transition">
            + New Test
          </Link>
          <button onClick={logout} className="text-muted hover:text-white text-sm transition">
            Sign out
          </button>
        </div>
      </nav>

      <div className="max-w-5xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-2xl font-bold text-white">My Reports</h2>
            <p className="text-muted text-sm mt-1">Last {reports.length} test run(s) — max 10 stored</p>
          </div>
          <button onClick={load} className="text-muted hover:text-white text-sm transition">
            ↻ Refresh
          </button>
        </div>

        {loading && (
          <div className="text-center text-muted py-20 animate-pulse">Loading reports…</div>
        )}

        {!loading && reports.length === 0 && (
          <div className="text-center py-20">
            <div className="text-5xl mb-4">📋</div>
            <p className="text-muted">No reports yet.</p>
            <Link href="/test"
              className="inline-block mt-4 bg-accent text-white px-6 py-2 rounded-xl hover:bg-indigo-500 transition">
              Run your first test
            </Link>
          </div>
        )}

        <div className="space-y-3">
          {reports.map(r => (
            <div key={r.id}
              className="bg-surface border border-border rounded-2xl p-5 flex items-center gap-5
                         hover:border-accent/40 transition group">

              <ScoreRing score={r.score} />

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-white font-medium truncate max-w-xs">{r.target_url}</span>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${STATUS_COLORS[r.overall_status] || STATUS_COLORS[r.status] || 'text-muted bg-border'}`}>
                    {r.overall_status || r.status}
                  </span>
                  {r.mode === 'discover' && (
                    <span className="text-xs bg-indigo-400/10 text-indigo-400 px-2 py-0.5 rounded-full">
                      🗺 discover
                    </span>
                  )}
                </div>
                <div className="flex gap-4 mt-1.5 text-xs text-muted flex-wrap">
                  {r.summary && (
                    <>
                      <span className="text-pass">✓ {r.summary.pass} pass</span>
                      <span className="text-fail">✗ {r.summary.fail + (r.summary.error||0)} fail</span>
                      <span className="text-warn">⚠ {r.summary.warn} warn</span>
                    </>
                  )}
                  {r.routes_count > 0 && <span>🗺 {r.routes_count} routes</span>}
                  <span>{new Date(r.created_at).toLocaleString()}</span>
                </div>
              </div>

              <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition">
                <Link href={`/reports/${r.id}`}
                  className="bg-accent/10 text-accent hover:bg-accent hover:text-white
                             text-sm px-3 py-1.5 rounded-lg transition">
                  View
                </Link>
                <button onClick={() => deleteReport(r.id)}
                  className="bg-fail/10 text-fail hover:bg-fail hover:text-white
                             text-sm px-3 py-1.5 rounded-lg transition">
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default withAuth(Dashboard);
