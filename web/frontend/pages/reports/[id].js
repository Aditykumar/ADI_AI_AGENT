import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { withAuth } from '../../contexts/AuthContext';
import api, { BASE, getToken } from '../../lib/api';

const STATUS_COLORS = {
  PASS:'text-pass', FAIL:'text-fail', WARN:'text-warn',
  running:'text-indigo-400', failed:'text-fail',
};

function StatCard({ label, value, color = 'text-white' }) {
  return (
    <div className="bg-surface2 rounded-xl p-4 text-center">
      <div className={`text-3xl font-bold ${color}`}>{value ?? '—'}</div>
      <div className="text-xs text-muted mt-1 uppercase tracking-wide">{label}</div>
    </div>
  );
}

function ReportPage() {
  const router         = useRouter();
  const { id }         = router.query;
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('overview');

  useEffect(() => {
    if (!id) return;
    api.get(`/api/reports/${id}`)
      .then(({ data }) => setReport(data))
      .catch(() => toast.error('Could not load report'))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return (
    <div className="min-h-screen bg-bg flex items-center justify-center text-muted animate-pulse">
      Loading report…
    </div>
  );

  if (!report) return (
    <div className="min-h-screen bg-bg flex items-center justify-center">
      <div className="text-center">
        <div className="text-4xl mb-4">❌</div>
        <p className="text-muted">Report not found</p>
        <Link href="/dashboard" className="text-accent mt-4 inline-block">← Dashboard</Link>
      </div>
    </div>
  );

  const s = report.summary || {};
  const scoreColor = (report.score||0) >= 80 ? 'text-pass' : (report.score||0) >= 60 ? 'text-warn' : 'text-fail';

  return (
    <div className="min-h-screen bg-bg">

      {/* Nav */}
      <nav className="border-b border-border bg-surface px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="text-xl">🤖</Link>
          <span className="text-muted">/</span>
          <span className="font-bold text-white truncate max-w-xs">{report.target_url}</span>
        </div>
        <Link href="/dashboard" className="text-muted hover:text-white text-sm">← Dashboard</Link>
      </nav>

      <div className="max-w-6xl mx-auto px-6 py-8">

        {/* Header */}
        <div className="flex items-start justify-between mb-6 flex-wrap gap-4">
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <span className={`text-3xl font-black ${scoreColor}`}>{report.score ?? '?'}<span className="text-lg font-normal text-muted">/100</span></span>
              <span className={`text-sm font-bold px-3 py-1 rounded-full bg-current/10 ${STATUS_COLORS[report.overall_status]||'text-muted'}`}>
                {report.overall_status || report.status}
              </span>
              {report.mode === 'discover' && (
                <span className="text-xs bg-indigo-400/10 text-indigo-400 px-2 py-1 rounded-full">🗺 discover mode</span>
              )}
            </div>
            <p className="text-muted text-sm mt-2">{new Date(report.created_at).toLocaleString()}</p>
          </div>
          {report.html_report && (
            <a href={`${BASE}/api/reports/${id}/html?token=${getToken()}`} target="_blank" rel="noreferrer"
              className="bg-surface border border-border hover:border-accent/50 text-white
                         text-sm px-4 py-2 rounded-xl transition">
              Open Full Report ↗
            </a>
          )}
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
          <StatCard label="Passed"    value={s.pass}                    color="text-pass" />
          <StatCard label="Failed"    value={(s.fail||0)+(s.error||0)}  color="text-fail" />
          <StatCard label="Warnings"  value={s.warn}                    color="text-warn" />
          <StatCard label="Total"     value={s.total}                   color="text-indigo-400" />
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-border mb-6 flex-wrap">
          {[['overview','📊 Overview'], ['html','🖥 Full Report'], ['json','📋 JSON']].map(([t,label]) => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm rounded-t-lg transition
                ${tab===t ? 'text-white bg-surface border border-b-0 border-border' : 'text-muted hover:text-white'}`}>
              {label}
            </button>
          ))}
        </div>

        {/* Overview tab */}
        {tab === 'overview' && report.json_results && (
          <div className="space-y-6">
            {/* Recommendations */}
            {report.json_results.recommendations?.length > 0 && (
              <div>
                <h3 className="text-sm font-bold text-muted uppercase tracking-wide mb-3">💡 Recommendations</h3>
                <div className="space-y-2">
                  {report.json_results.recommendations.map((r, i) => {
                    const bc = { critical:'border-fail', high:'border-orange-400', medium:'border-warn', low:'border-blue-400' };
                    return (
                      <div key={i} className={`bg-surface border-l-4 ${bc[r.severity]||'border-border'} rounded-r-xl p-4`}>
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`text-xs font-bold px-2 py-0.5 rounded-full
                            ${r.severity==='critical'||r.severity==='high' ? 'bg-fail/10 text-fail' : 'bg-warn/10 text-warn'}`}>
                            {r.severity}
                          </span>
                          <span className="text-white font-medium text-sm">{r.title}</span>
                        </div>
                        <p className="text-muted text-xs">{r.description}</p>
                        <p className="text-indigo-400 text-xs mt-1">💡 {r.guidance}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Category summaries */}
            {report.json_results.summary?.by_category && (
              <div>
                <h3 className="text-sm font-bold text-muted uppercase tracking-wide mb-3">Results by Category</h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {Object.entries(report.json_results.summary.by_category).map(([cat, counts]) => (
                    <div key={cat} className="bg-surface border border-border rounded-xl p-4">
                      <div className="text-white font-semibold text-sm mb-2">{cat}</div>
                      <div className="text-xs space-y-0.5">
                        <div className="text-pass">✓ {counts.pass || 0} pass</div>
                        <div className="text-fail">✗ {(counts.fail||0)+(counts.error||0)} fail</div>
                        <div className="text-warn">⚠ {counts.warn || 0} warn</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* HTML iframe tab */}
        {tab === 'html' && (
          report.html_report
            ? <iframe
                src={`${BASE}/api/reports/${id}/html?token=${getToken()}`}
                className="w-full rounded-xl border border-border"
                style={{ height: '80vh' }}
                title="Full HTML Report" />
            : <p className="text-muted text-center py-10">HTML report not available yet.</p>
        )}

        {/* JSON tab */}
        {tab === 'json' && (
          <pre className="bg-surface border border-border rounded-xl p-5 overflow-auto text-xs text-muted"
            style={{ maxHeight: '70vh' }}>
            {JSON.stringify(report.json_results, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}

export default withAuth(ReportPage);
