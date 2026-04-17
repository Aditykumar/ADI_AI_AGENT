import { useState, useRef } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { useAuth, withAuth } from '../contexts/AuthContext';
import api, { BASE, getToken } from '../lib/api';

const PHASES = { plan:'10', ui:'30', api:'55', perf:'72', security:'85', report:'93', done:'100' };

// ── Route checkbox item ────────────────────────────────────────────────
function RouteItem({ item, checked, onChange }) {
  const isApi   = !!item.method;
  const method  = item.method || '';
  const MCOLS   = { GET:'text-green-400', POST:'text-blue-400', PUT:'text-yellow-400',
                    PATCH:'text-cyan-400', DELETE:'text-red-400' };
  return (
    <label className="flex items-center gap-3 px-4 py-2.5 rounded-lg hover:bg-surface2 cursor-pointer group">
      <input type="checkbox" checked={checked} onChange={onChange}
        className="w-4 h-4 accent-indigo-500 flex-shrink-0" />
      {isApi
        ? <span className={`font-mono text-xs font-bold w-14 flex-shrink-0 ${MCOLS[method]||'text-muted'}`}>{method}</span>
        : <span className="text-muted text-xs w-14 flex-shrink-0">📄 page</span>
      }
      <span className="text-white text-sm truncate">{item.path}</span>
      {item.title && <span className="text-muted text-xs truncate hidden group-hover:block">{item.title}</span>}
    </label>
  );
}

// ── Log line ───────────────────────────────────────────────────────────
function LogLine({ msg }) {
  const color = msg.includes('Error') || msg.includes('fail') ? 'text-fail'
    : msg.includes('pass') || msg.includes('done') || msg.includes('✓') ? 'text-pass'
    : msg.includes('warn') ? 'text-warn'
    : 'text-muted';
  return <div className={`sse-log ${color}`}>{msg}</div>;
}

function TestPage() {
  const { user, logout } = useAuth();
  const router   = useRouter();

  // Steps: url → discover → select → run → done
  const [step, setStep] = useState('url');

  // URL step
  const [url,     setUrl]     = useState('');
  const [apiUrl,  setApiUrl]  = useState('');
  const [skipAI,  setSkipAI]  = useState(false);
  const [testTypes, setTestTypes] = useState({ ui: true, api: true, perf: true, security: true });

  // Auth for target site
  const [showAuth,   setShowAuth]   = useState(false);
  const [loginUrl,   setLoginUrl]   = useState('');
  const [authUser,   setAuthUser]   = useState('');
  const [authPass,   setAuthPass]   = useState('');
  const [authToken,  setAuthToken]  = useState('');

  // Discover step
  const [discovering, setDiscovering] = useState(false);
  const [discovery,   setDiscovery]   = useState(null);
  const [filter,      setFilter]      = useState('');
  const [selected,    setSelected]    = useState({ pages: {}, api: {} }); // id→bool

  // Run step
  const [running,    setRunning]    = useState(false);
  const [progress,   setProgress]   = useState(0);
  const [phase,      setPhase]      = useState('');
  const [logs,       setLogs]       = useState([]);
  const [reportId,   setReportId]   = useState(null);
  const [liveScreen, setLiveScreen] = useState(null);   // base64 screenshot
  const [liveUrl,    setLiveUrl]    = useState('');
  const [liveLabel,  setLiveLabel]  = useState('');
  const [actions,    setActions]    = useState([]);     // live action feed
  const [networks,   setNetworks]   = useState([]);     // network calls
  const logRef    = useRef(null);
  const actionRef = useRef(null);

  // ── Discover routes ─────────────────────────────────────────────────
  async function handleDiscover(e) {
    e.preventDefault();
    if (!url) return toast.error('Enter a URL');
    setDiscovering(true);
    const authOpts = showAuth ? { loginUrl, username: authUser, password: authPass, token: authToken } : {};
    try {
      const { data } = await api.post('/api/discover', { url, auth: authOpts });
      setDiscovery(data);
      // Pre-select all
      const pages = {}, apiR = {};
      data.pages.forEach((p, i) => { pages[i] = true; });
      data.api_routes.forEach((a, i) => { apiR[i] = true; });
      setSelected({ pages, api: apiR });
      setStep('select');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Discovery failed');
    } finally {
      setDiscovering(false);
    }
  }

  // ── Start tests ─────────────────────────────────────────────────────
  async function handleStart() {
    const selectedPages     = (discovery?.pages      || []).filter((_, i) => selected.pages[i]);
    const selectedApiRoutes = (discovery?.api_routes || []).filter((_, i) => selected.api[i]);

    setRunning(true);
    setStep('run');
    setLogs([]);
    setProgress(5);

    try {
      const authOpts = showAuth ? { loginUrl, username: authUser, password: authPass, token: authToken } : {};
      const { data } = await api.post('/api/test/start', {
        targetUrl: url, apiUrl: apiUrl || url,
        selectedPages, selectedApiRoutes,
        testTypes, skipAI,
        auth: authOpts,
      });

      setReportId(data.reportId);
      listenSSE(data.runId);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to start test');
      setRunning(false);
    }
  }

  // ── SSE listener ────────────────────────────────────────────────────
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

      // Live screenshot update
      if (d.type === 'screenshot' && d.img) {
        setLiveScreen(d.img);
        setLiveUrl(d.url || '');
        setLiveLabel(d.label || '');
      }

      // Navigate event
      if (d.type === 'navigate') {
        setLiveUrl(d.url || '');
        setActions(a => {
          const next = [{ type: 'navigate', text: `→ ${d.url}`, ts: d.ts }, ...a].slice(0, 100);
          setTimeout(() => actionRef.current?.scrollTo(0, 0), 30);
          return next;
        });
      }

      // Test start/done
      if (d.type === 'test_start') {
        setActions(a => [{ type: 'test', text: `▶ ${d.name}`, ts: d.ts }, ...a].slice(0, 100));
      }
      if (d.type === 'test_done') {
        const icon = d.status === 'pass' ? '✓' : d.status === 'fail' ? '✗' : '~';
        setActions(a => [{ type: d.status, text: `${icon} ${d.name} (${d.duration_ms}ms)`, ts: d.ts }, ...a].slice(0, 100));
      }

      // API calls
      if (d.type === 'api_call') {
        setActions(a => [{ type: 'api', text: `${d.method} ${d.url}`, ts: d.ts }, ...a].slice(0, 100));
      }
      if (d.type === 'api_result') {
        const icon = d.result === 'pass' ? '✓' : '✗';
        setActions(a => [{ type: d.result, text: `${icon} ${d.method} ${d.url} → ${d.status || d.error}`, ts: d.ts }, ...a].slice(0, 100));
      }

      // Network calls
      if (d.type === 'network' && d.type !== 'response') {
        setNetworks(n => [{ method: d.method, url: d.url, status: d.status, ts: d.ts }, ...n].slice(0, 50));
      }
    });

    source.addEventListener('complete', e => {
      const d = JSON.parse(e.data);
      setProgress(100);
      setPhase('done');
      setLogs(l => [...l, `✓ Done! Score: ${d.score}/100  Status: ${d.overall_status}`]);
      source.close();
      setStep('done');
    });

    source.addEventListener('error', e => {
      try {
        const d = JSON.parse(e.data);
        toast.error(d.message || 'Test error');
      } catch (_) {}
      source.close();
      setRunning(false);
    });

    source.onerror = () => source.close();
  }

  // ── Toggle helpers ─────────────────────────────────────────────────
  function toggleAll(type, val) {
    const items = type === 'pages' ? discovery.pages : discovery.api_routes;
    const next  = {};
    items.forEach((_, i) => { next[i] = val; });
    setSelected(s => ({ ...s, [type === 'pages' ? 'pages' : 'api']: next }));
  }

  function filteredItems(items) {
    if (!filter) return items;
    return items.filter(item => (item.path||'').toLowerCase().includes(filter.toLowerCase()));
  }

  const selectedPageCount = Object.values(selected.pages).filter(Boolean).length;
  const selectedApiCount  = Object.values(selected.api).filter(Boolean).length;

  return (
    <div className="min-h-screen bg-bg">

      {/* Nav */}
      <nav className="border-b border-border bg-surface px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="text-xl">🤖</Link>
          <span className="font-bold text-white">New Test</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-muted text-sm">{user?.name}</span>
          <Link href="/dashboard" className="text-muted hover:text-white text-sm">← Dashboard</Link>
        </div>
      </nav>

      <div className="max-w-3xl mx-auto px-6 py-10">

        {/* Step indicator */}
        <div className="flex items-center gap-2 mb-10 text-sm">
          {[['url','1. URL'],['select','2. Routes'],['run','3. Testing'],['done','4. Done']].map(([s,label]) => (
            <div key={s} className={`flex items-center gap-2 ${step===s?'text-white font-semibold':'text-muted'}`}>
              <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs
                ${step===s ? 'bg-accent text-white' : 'bg-border text-muted'}`}>
                {['url','select','run','done'].indexOf(s)+1}
              </span>
              {label}
              {s !== 'done' && <span className="text-border mx-1">›</span>}
            </div>
          ))}
        </div>

        {/* ── STEP 1: URL ─────────────────────────────────────────── */}
        {step === 'url' && (
          <form onSubmit={handleDiscover} className="space-y-6">
            <div className="bg-surface border border-border rounded-2xl p-6 space-y-5">
              <h2 className="text-lg font-bold text-white">Target Site</h2>

              <div>
                <label className="block text-sm text-muted mb-1.5">Site URL <span className="text-fail">*</span></label>
                <input value={url} onChange={e => setUrl(e.target.value)} required
                  placeholder="https://yoursite.com"
                  className="w-full bg-bg border border-border rounded-xl px-4 py-2.5 text-white
                             placeholder-muted/50 focus:outline-none focus:border-accent" />
              </div>

              <div>
                <label className="block text-sm text-muted mb-1.5">API Base URL <span className="text-muted/60">(optional)</span></label>
                <input value={apiUrl} onChange={e => setApiUrl(e.target.value)}
                  placeholder="https://api.yoursite.com"
                  className="w-full bg-bg border border-border rounded-xl px-4 py-2.5 text-white
                             placeholder-muted/50 focus:outline-none focus:border-accent" />
              </div>

              <div className="border-t border-border pt-4">
                <p className="text-sm font-medium text-muted mb-3">Test types</p>
                <div className="grid grid-cols-2 gap-2">
                  {[['ui','🖥 UI & SSO'],['api','🔌 API'],['perf','⚡ Performance'],['security','🔒 Security']].map(([k,label]) => (
                    <label key={k} className="flex items-center gap-2 text-sm text-white cursor-pointer">
                      <input type="checkbox" checked={testTypes[k]}
                        onChange={e => setTestTypes(t => ({ ...t, [k]: e.target.checked }))}
                        className="accent-indigo-500 w-4 h-4" />
                      {label}
                    </label>
                  ))}
                </div>
              </div>

              <label className="flex items-center gap-2 text-sm text-muted cursor-pointer">
                <input type="checkbox" checked={skipAI} onChange={e => setSkipAI(e.target.checked)}
                  className="accent-indigo-500 w-4 h-4" />
                Skip AI (use built-in test plan — faster)
              </label>

              {/* Auth section */}
              <div className="border-t border-border pt-4">
                <button type="button" onClick={() => setShowAuth(a => !a)}
                  className="flex items-center gap-2 text-sm text-muted hover:text-white transition">
                  <span>{showAuth ? '▼' : '▶'}</span>
                  🔐 Site requires login? <span className="text-accent text-xs">(optional)</span>
                </button>

                {showAuth && (
                  <div className="mt-3 space-y-3">
                    <div>
                      <label className="block text-xs text-muted mb-1">Login Page URL</label>
                      <input value={loginUrl} onChange={e => setLoginUrl(e.target.value)}
                        placeholder="https://yoursite.com/login"
                        className="w-full bg-bg border border-border rounded-xl px-4 py-2 text-white text-sm
                                   placeholder-muted/50 focus:outline-none focus:border-accent" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-muted mb-1">Username / Email</label>
                        <input value={authUser} onChange={e => setAuthUser(e.target.value)}
                          placeholder="admin@yoursite.com"
                          className="w-full bg-bg border border-border rounded-xl px-4 py-2 text-white text-sm
                                     placeholder-muted/50 focus:outline-none focus:border-accent" />
                      </div>
                      <div>
                        <label className="block text-xs text-muted mb-1">Password</label>
                        <input type="password" value={authPass} onChange={e => setAuthPass(e.target.value)}
                          placeholder="••••••••"
                          className="w-full bg-bg border border-border rounded-xl px-4 py-2 text-white text-sm
                                     placeholder-muted/50 focus:outline-none focus:border-accent" />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs text-muted mb-1">Bearer Token <span className="text-muted/60">(if already have one)</span></label>
                      <input value={authToken} onChange={e => setAuthToken(e.target.value)}
                        placeholder="eyJhbGci..."
                        className="w-full bg-bg border border-border rounded-xl px-4 py-2 text-white text-sm
                                   placeholder-muted/50 focus:outline-none focus:border-accent" />
                    </div>
                  </div>
                )}
              </div>
            </div>

            <button type="submit" disabled={discovering}
              className="w-full bg-accent hover:bg-indigo-500 disabled:opacity-50
                         text-white font-semibold py-3 rounded-xl transition">
              {discovering ? '🔍 Discovering routes…' : '🔍 Discover Routes'}
            </button>
          </form>
        )}

        {/* ── STEP 2: Select routes ──────────────────────────────── */}
        {step === 'select' && discovery && (
          <div className="space-y-5">
            <div className="bg-surface border border-border rounded-2xl p-5">
              <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
                <div>
                  <h2 className="text-lg font-bold text-white">Select Routes</h2>
                  <p className="text-muted text-sm">{discovery.pages.length} pages · {discovery.api_routes.length} API routes discovered</p>
                </div>
                <input value={filter} onChange={e => setFilter(e.target.value)}
                  placeholder="🔍 filter routes…"
                  className="bg-bg border border-border rounded-xl px-4 py-2 text-white text-sm
                             placeholder-muted/50 focus:outline-none focus:border-accent w-52" />
              </div>

              {/* Pages */}
              {discovery.pages.length > 0 && (
                <div className="mb-4">
                  <div className="flex items-center justify-between px-4 mb-1">
                    <span className="text-xs font-bold text-muted uppercase tracking-wider">📄 Pages ({selectedPageCount}/{discovery.pages.length})</span>
                    <div className="flex gap-3 text-xs text-accent">
                      <button onClick={() => toggleAll('pages', true)}>All</button>
                      <button onClick={() => toggleAll('pages', false)}>None</button>
                    </div>
                  </div>
                  <div className="max-h-64 overflow-y-auto">
                    {filteredItems(discovery.pages).map((p, i) => {
                      const realIdx = discovery.pages.indexOf(p);
                      return <RouteItem key={realIdx} item={p} checked={!!selected.pages[realIdx]}
                        onChange={e => setSelected(s => ({ ...s, pages: { ...s.pages, [realIdx]: e.target.checked } }))} />;
                    })}
                  </div>
                </div>
              )}

              {/* API Routes */}
              {discovery.api_routes.length > 0 && (
                <div>
                  <div className="flex items-center justify-between px-4 mb-1">
                    <span className="text-xs font-bold text-muted uppercase tracking-wider">🔌 API Routes ({selectedApiCount}/{discovery.api_routes.length})</span>
                    <div className="flex gap-3 text-xs text-accent">
                      <button onClick={() => toggleAll('api', true)}>All</button>
                      <button onClick={() => toggleAll('api', false)}>None</button>
                    </div>
                  </div>
                  <div className="max-h-48 overflow-y-auto">
                    {filteredItems(discovery.api_routes).map((a, i) => {
                      const realIdx = discovery.api_routes.indexOf(a);
                      return <RouteItem key={realIdx} item={a} checked={!!selected.api[realIdx]}
                        onChange={e => setSelected(s => ({ ...s, api: { ...s.api, [realIdx]: e.target.checked } }))} />;
                    })}
                  </div>
                </div>
              )}
            </div>

            <div className="flex gap-3">
              <button onClick={() => setStep('url')}
                className="flex-1 bg-surface border border-border hover:border-accent/50
                           text-white py-3 rounded-xl transition">
                ← Back
              </button>
              <button onClick={handleStart}
                disabled={selectedPageCount + selectedApiCount === 0}
                className="flex-1 bg-accent hover:bg-indigo-500 disabled:opacity-50
                           text-white font-semibold py-3 rounded-xl transition">
                ▶ Run Tests ({selectedPageCount + selectedApiCount} routes)
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 3: Running ────────────────────────────────────── */}
        {step === 'run' && (
          <div className="space-y-4">

            {/* Progress bar */}
            <div className="bg-surface border border-border rounded-2xl p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-white">
                  Phase: <span className="text-accent">{phase || 'starting…'}</span>
                </span>
                <span className="text-accent font-bold">{progress}%</span>
              </div>
              <div className="h-2 bg-bg rounded-full overflow-hidden">
                <div className="h-full bg-accent rounded-full transition-all duration-500"
                  style={{ width: `${progress}%` }} />
              </div>
            </div>

            {/* Live browser view */}
            <div className="bg-surface border border-border rounded-2xl overflow-hidden">
              {/* Browser chrome bar */}
              <div className="bg-[#1a1f2e] border-b border-border px-4 py-2 flex items-center gap-3">
                <div className="flex gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-red-500/60" />
                  <div className="w-3 h-3 rounded-full bg-yellow-500/60" />
                  <div className="w-3 h-3 rounded-full bg-green-500/60" />
                </div>
                <div className="flex-1 bg-bg rounded-lg px-3 py-1 text-xs text-muted font-mono truncate">
                  {liveUrl || url || 'waiting for browser…'}
                </div>
                {liveScreen && (
                  <span className="text-xs text-green-400 animate-pulse">● LIVE</span>
                )}
              </div>

              {/* Screenshot / placeholder */}
              <div className="relative bg-[#0d1117]" style={{ minHeight: '360px' }}>
                {liveScreen ? (
                  <img
                    src={`data:image/png;base64,${liveScreen}`}
                    alt={liveLabel}
                    className="w-full object-contain"
                    style={{ maxHeight: '480px' }}
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center h-full py-20 text-muted">
                    <div className="text-4xl mb-3 animate-pulse">🌐</div>
                    <p className="text-sm">Browser starting…</p>
                    <p className="text-xs mt-1 text-muted/50">Screenshots will appear here</p>
                  </div>
                )}
                {liveLabel && (
                  <div className="absolute bottom-0 left-0 right-0 bg-black/70 px-3 py-1.5 text-xs text-white truncate">
                    {liveLabel}
                  </div>
                )}
              </div>
            </div>

            {/* Actions + Network side by side */}
            <div className="grid grid-cols-2 gap-4">

              {/* Action log */}
              <div className="bg-surface border border-border rounded-2xl p-4">
                <h3 className="text-xs font-bold text-muted uppercase tracking-wider mb-3">
                  🎬 Actions
                </h3>
                <div ref={actionRef} className="space-y-1 h-48 overflow-y-auto">
                  {actions.length === 0
                    ? <span className="text-muted text-xs animate-pulse">Waiting…</span>
                    : actions.map((a, i) => (
                      <div key={i} className={`text-xs font-mono truncate ${
                        a.type === 'pass'     ? 'text-green-400' :
                        a.type === 'fail'     ? 'text-red-400' :
                        a.type === 'navigate' ? 'text-blue-400' :
                        a.type === 'api'      ? 'text-yellow-400' :
                        a.type === 'test'     ? 'text-white' : 'text-muted'
                      }`}>{a.text}</div>
                    ))
                  }
                </div>
              </div>

              {/* Network calls */}
              <div className="bg-surface border border-border rounded-2xl p-4">
                <h3 className="text-xs font-bold text-muted uppercase tracking-wider mb-3">
                  🌐 Network
                </h3>
                <div className="space-y-1 h-48 overflow-y-auto">
                  {networks.length === 0
                    ? <span className="text-muted text-xs animate-pulse">No requests yet…</span>
                    : networks.map((n, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs font-mono">
                        <span className={`flex-shrink-0 font-bold ${
                          n.method === 'GET'    ? 'text-green-400' :
                          n.method === 'POST'   ? 'text-blue-400' :
                          n.method === 'DELETE' ? 'text-red-400'  : 'text-yellow-400'
                        }`}>{n.method}</span>
                        <span className="text-muted truncate">{n.url?.replace(/https?:\/\/[^/]+/, '')}</span>
                        {n.status && <span className={`flex-shrink-0 ${n.status < 400 ? 'text-green-400' : 'text-red-400'}`}>{n.status}</span>}
                      </div>
                    ))
                  }
                </div>
              </div>
            </div>

            {/* Progress log */}
            <div className="bg-surface border border-border rounded-2xl p-4">
              <h3 className="text-xs font-bold text-muted uppercase tracking-wider mb-3">📋 Log</h3>
              <div ref={logRef} className="bg-bg rounded-xl p-3 h-36 overflow-y-auto space-y-1 font-mono text-xs">
                {logs.length === 0
                  ? <span className="text-muted animate-pulse">Initializing…</span>
                  : logs.map((l, i) => <LogLine key={i} msg={l} />)
                }
              </div>
            </div>

          </div>
        )}

        {/* ── STEP 4: Done ───────────────────────────────────────── */}
        {step === 'done' && reportId && (
          <div className="text-center space-y-6">
            <div className="bg-surface border border-border rounded-2xl p-10">
              <div className="text-6xl mb-4">✅</div>
              <h2 className="text-2xl font-bold text-white mb-2">Testing Complete!</h2>
              <p className="text-muted">Your report is ready.</p>
            </div>
            <div className="flex gap-3">
              <Link href={`/reports/${reportId}`}
                className="flex-1 bg-accent hover:bg-indigo-500 text-white font-semibold
                           py-3 rounded-xl text-center transition">
                View Report →
              </Link>
              <Link href="/dashboard"
                className="flex-1 bg-surface border border-border hover:border-accent/50
                           text-white py-3 rounded-xl text-center transition">
                Dashboard
              </Link>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

export default withAuth(TestPage);
