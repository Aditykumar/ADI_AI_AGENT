import { useState, useRef } from 'react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { useAuth, withAuth } from '../contexts/AuthContext';
import api, { BASE, getToken } from '../lib/api';

const EXAMPLE_TASKS = [
  'Log in with the provided credentials and navigate to the dashboard',
  'Find the contact form, fill it with test data and submit',
  'Navigate to the pricing page and verify all plan details are visible',
  'Check if the site has a working search feature — search for "test"',
  'Test the registration flow with a new user account',
];

function AIAgentPage() {
  const { user } = useAuth();
  const [url,       setUrl]       = useState('');
  const [task,      setTask]      = useState('');
  const [username,  setUsername]  = useState('');
  const [password,  setPassword]  = useState('');
  const [step,      setStep]      = useState('form'); // form | running | done
  const [progress,  setProgress]  = useState(0);
  const [phase,     setPhase]     = useState('');
  const [logs,      setLogs]      = useState([]);
  const [actions,   setActions]   = useState([]);
  const [networks,  setNetworks]  = useState([]);
  const [liveScreen, setLiveScreen] = useState(null);
  const [liveUrl,    setLiveUrl]    = useState('');
  const [liveLabel,  setLiveLabel]  = useState('');
  const [reportId,   setReportId]   = useState(null);
  const logRef    = useRef(null);
  const actionRef = useRef(null);

  async function handleStart(e) {
    e.preventDefault();
    if (!url)  return toast.error('Enter a URL');
    if (!task) return toast.error('Describe what the AI should do');

    // Build full task with credentials if provided
    let fullTask = task;
    if (username && password) {
      fullTask += ` Use username: "${username}" and password: "${password}" to log in.`;
    }

    setStep('running');
    setLogs([]);
    setActions([]);
    setNetworks([]);
    setLiveScreen(null);
    setProgress(5);

    try {
      const { data } = await api.post('/api/ai-run/start', {
        targetUrl: url,
        task: fullTask,
      });

      setReportId(data.reportId);
      listenSSE(data.runId);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to start AI agent');
      setStep('form');
    }
  }

  function listenSSE(runId) {
    const token  = getToken();
    const source = new EventSource(`${BASE}/api/test/stream/${runId}?token=${token}`);

    source.addEventListener('progress', e => {
      const { phase: ph, message, progress: pct } = JSON.parse(e.data);
      setPhase(ph);
      if (pct) setProgress(pct);
      if (message) setLogs(l => {
        const next = [...l, `[${ph}] ${message}`];
        setTimeout(() => logRef.current?.scrollTo(0, 99999), 50);
        return next;
      });
    });

    source.addEventListener('action', e => {
      const d = JSON.parse(e.data);

      if (d.type === 'screenshot' && d.img) {
        setLiveScreen(d.img);
        setLiveUrl(d.url || '');
        setLiveLabel(d.label || '');
      }
      if (d.type === 'navigate') {
        setLiveUrl(d.url || '');
        setActions(a => [{ type: 'navigate', text: `→ ${d.url}`, ts: d.ts }, ...a].slice(0, 100));
      }
      if (d.type === 'test_start') {
        setActions(a => [{ type: 'ai', text: `🤖 ${d.name}`, ts: d.ts }, ...a].slice(0, 100));
        setTimeout(() => actionRef.current?.scrollTo(0, 0), 30);
      }
      if (d.type === 'test_done') {
        const icon = d.status === 'pass' ? '✓' : '✗';
        setActions(a => [{ type: d.status, text: `${icon} ${d.name}`, ts: d.ts }, ...a].slice(0, 100));
      }
      if (d.type === 'network') {
        setNetworks(n => [{ method: d.method, url: d.url, status: d.status }, ...n].slice(0, 50));
      }
    });

    source.addEventListener('complete', e => {
      const d = JSON.parse(e.data);
      setProgress(100);
      setPhase('done');
      setLogs(l => [...l, `✓ Done! Score: ${d.score}/100`]);
      source.close();
      setStep('done');
    });

    source.addEventListener('error', e => {
      try { toast.error(JSON.parse(e.data).message || 'Agent error'); } catch (_) {}
      source.close();
      setStep('form');
    });

    source.onerror = () => source.close();
  }

  return (
    <div className="min-h-screen bg-bg">

      {/* Nav */}
      <nav className="border-b border-border bg-surface px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="text-xl">🤖</Link>
          <span className="font-bold text-white">AI Browser Agent</span>
          <span className="text-xs bg-accent/20 text-accent px-2 py-0.5 rounded-full">BETA</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-muted text-sm">{user?.name}</span>
          <Link href="/dashboard" className="text-muted hover:text-white text-sm">← Dashboard</Link>
        </div>
      </nav>

      <div className="max-w-5xl mx-auto px-6 py-10">

        {/* ── FORM ─────────────────────────────────────────────────── */}
        {step === 'form' && (
          <div className="space-y-6 max-w-2xl mx-auto">
            <div className="text-center mb-8">
              <div className="text-5xl mb-3">🧠</div>
              <h1 className="text-2xl font-bold text-white">AI Browser Agent</h1>
              <p className="text-muted mt-2">Tell the AI what to do — it will browse, click, fill forms and test your site autonomously</p>
            </div>

            <form onSubmit={handleStart} className="space-y-5">
              <div className="bg-surface border border-border rounded-2xl p-6 space-y-4">

                <div>
                  <label className="block text-sm text-muted mb-1.5">Site URL <span className="text-fail">*</span></label>
                  <input value={url} onChange={e => setUrl(e.target.value)} required
                    placeholder="https://yoursite.com"
                    className="w-full bg-bg border border-border rounded-xl px-4 py-2.5 text-white
                               placeholder-muted/50 focus:outline-none focus:border-accent" />
                </div>

                <div>
                  <label className="block text-sm text-muted mb-1.5">
                    Task Description <span className="text-fail">*</span>
                  </label>
                  <textarea value={task} onChange={e => setTask(e.target.value)} required rows={3}
                    placeholder="Describe what the AI agent should do on this site…"
                    className="w-full bg-bg border border-border rounded-xl px-4 py-2.5 text-white
                               placeholder-muted/50 focus:outline-none focus:border-accent resize-none" />
                  <div className="flex flex-wrap gap-2 mt-2">
                    {EXAMPLE_TASKS.map((t, i) => (
                      <button key={i} type="button" onClick={() => setTask(t)}
                        className="text-xs bg-surface2 hover:bg-border text-muted hover:text-white
                                   px-2 py-1 rounded-lg transition truncate max-w-xs">
                        {t}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="border-t border-border pt-4">
                  <p className="text-sm text-muted mb-3">🔐 Login credentials <span className="text-muted/50">(if site requires login)</span></p>
                  <div className="grid grid-cols-2 gap-3">
                    <input value={username} onChange={e => setUsername(e.target.value)}
                      placeholder="Username / Email"
                      className="bg-bg border border-border rounded-xl px-4 py-2 text-white text-sm
                                 placeholder-muted/50 focus:outline-none focus:border-accent" />
                    <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                      placeholder="Password"
                      className="bg-bg border border-border rounded-xl px-4 py-2 text-white text-sm
                                 placeholder-muted/50 focus:outline-none focus:border-accent" />
                  </div>
                </div>
              </div>

              <button type="submit"
                className="w-full bg-accent hover:bg-indigo-500 text-white font-semibold py-3 rounded-xl transition">
                🚀 Launch AI Agent
              </button>
            </form>
          </div>
        )}

        {/* ── RUNNING ──────────────────────────────────────────────── */}
        {step === 'running' && (
          <div className="space-y-4">

            {/* Progress */}
            <div className="bg-surface border border-border rounded-2xl p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-white font-medium">
                  🤖 AI Agent Running — <span className="text-accent">{phase || 'starting…'}</span>
                </span>
                <span className="text-accent font-bold">{progress}%</span>
              </div>
              <div className="h-2 bg-bg rounded-full overflow-hidden">
                <div className="h-full bg-accent rounded-full transition-all duration-500"
                  style={{ width: `${progress}%` }} />
              </div>
            </div>

            {/* Live browser */}
            <div className="bg-surface border border-border rounded-2xl overflow-hidden">
              <div className="bg-[#1a1f2e] border-b border-border px-4 py-2 flex items-center gap-3">
                <div className="flex gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-red-500/60" />
                  <div className="w-3 h-3 rounded-full bg-yellow-500/60" />
                  <div className="w-3 h-3 rounded-full bg-green-500/60" />
                </div>
                <div className="flex-1 bg-bg rounded-lg px-3 py-1 text-xs text-muted font-mono truncate">
                  {liveUrl || url}
                </div>
                <span className="text-xs text-green-400 animate-pulse font-medium">● LIVE</span>
              </div>
              <div className="relative bg-[#0d1117]" style={{ minHeight: '400px' }}>
                {liveScreen ? (
                  <img src={`data:image/png;base64,${liveScreen}`} alt={liveLabel}
                    className="w-full object-contain" style={{ maxHeight: '520px' }} />
                ) : (
                  <div className="flex flex-col items-center justify-center h-full py-24 text-muted">
                    <div className="text-5xl mb-4 animate-bounce">🧠</div>
                    <p className="text-sm">AI agent is thinking…</p>
                    <p className="text-xs mt-1 text-muted/50">Screenshots appear after each action</p>
                  </div>
                )}
                {liveLabel && (
                  <div className="absolute bottom-0 left-0 right-0 bg-black/70 px-3 py-1.5 text-xs text-white truncate">
                    🤖 {liveLabel}
                  </div>
                )}
              </div>
            </div>

            {/* Actions + Network */}
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-surface border border-border rounded-2xl p-4">
                <h3 className="text-xs font-bold text-muted uppercase tracking-wider mb-3">🎬 Agent Actions</h3>
                <div ref={actionRef} className="space-y-1 h-52 overflow-y-auto">
                  {actions.length === 0
                    ? <span className="text-muted text-xs animate-pulse">Waiting for agent…</span>
                    : actions.map((a, i) => (
                      <div key={i} className={`text-xs font-mono truncate ${
                        a.type === 'pass'     ? 'text-green-400' :
                        a.type === 'fail'     ? 'text-red-400'   :
                        a.type === 'navigate' ? 'text-blue-400'  :
                        a.type === 'ai'       ? 'text-purple-400':
                        'text-muted'
                      }`}>{a.text}</div>
                    ))
                  }
                </div>
              </div>

              <div className="bg-surface border border-border rounded-2xl p-4">
                <h3 className="text-xs font-bold text-muted uppercase tracking-wider mb-3">🌐 Network Calls</h3>
                <div className="space-y-1 h-52 overflow-y-auto">
                  {networks.length === 0
                    ? <span className="text-muted text-xs">No requests yet…</span>
                    : networks.map((n, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs font-mono">
                        <span className={`flex-shrink-0 font-bold ${
                          n.method === 'GET'  ? 'text-green-400' :
                          n.method === 'POST' ? 'text-blue-400'  : 'text-yellow-400'}`}>{n.method}</span>
                        <span className="text-muted truncate">{n.url?.replace(/https?:\/\/[^/]+/, '')}</span>
                        {n.status && <span className={`flex-shrink-0 ${n.status < 400 ? 'text-green-400' : 'text-red-400'}`}>{n.status}</span>}
                      </div>
                    ))
                  }
                </div>
              </div>
            </div>

            {/* Log */}
            <div className="bg-surface border border-border rounded-2xl p-4">
              <h3 className="text-xs font-bold text-muted uppercase tracking-wider mb-2">📋 Log</h3>
              <div ref={logRef} className="bg-bg rounded-xl p-3 h-32 overflow-y-auto font-mono text-xs space-y-1">
                {logs.length === 0
                  ? <span className="text-muted animate-pulse">Starting…</span>
                  : logs.map((l, i) => <div key={i} className="text-muted">{l}</div>)
                }
              </div>
            </div>
          </div>
        )}

        {/* ── DONE ─────────────────────────────────────────────────── */}
        {step === 'done' && reportId && (
          <div className="text-center space-y-6 max-w-md mx-auto">
            <div className="bg-surface border border-border rounded-2xl p-10">
              <div className="text-6xl mb-4">🎉</div>
              <h2 className="text-2xl font-bold text-white mb-2">AI Agent Complete!</h2>
              <p className="text-muted">The agent finished the task. View the full report below.</p>
            </div>
            <div className="flex gap-3">
              <Link href={`/reports/${reportId}`}
                className="flex-1 bg-accent hover:bg-indigo-500 text-white font-semibold
                           py-3 rounded-xl text-center transition">
                View Report →
              </Link>
              <button onClick={() => setStep('form')}
                className="flex-1 bg-surface border border-border hover:border-accent/50
                           text-white py-3 rounded-xl transition">
                Run Again
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

export default withAuth(AIAgentPage);
