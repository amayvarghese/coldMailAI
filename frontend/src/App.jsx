import { useCallback, useEffect, useState } from 'react';

/** Production: set VITE_API_URL in Vercel to your API origin (e.g. https://your-api.railway.app) — no trailing slash. Local dev: leave unset to use Vite proxy. */
const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

const api = (path, options = {}) =>
  fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });

function Badge({ children, className = '' }) {
  return (
    <span
      className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${className}`}
    >
      {children}
    </span>
  );
}

function formatTime(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export default function App() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [role, setRole] = useState('');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [leads, setLeads] = useState([]);
  const [replyLead, setReplyLead] = useState(null);
  const [logReplyFor, setLogReplyFor] = useState(null);
  const [logReplyText, setLogReplyText] = useState('');
  const [lastRefresh, setLastRefresh] = useState(null);
  const [capabilities, setCapabilities] = useState(null);

  const loadLeads = useCallback(async () => {
    try {
      const r = await api('/api/leads');
      if (!r.ok) throw new Error(await r.text());
      const data = await r.json();
      setLeads(Array.isArray(data) ? data : []);
      setLastRefresh(new Date());
    } catch (e) {
      console.error(e);
    }
  }, []);

  const loadConfig = useCallback(async () => {
    try {
      const r = await api('/api/config');
      if (r.ok) {
        const data = await r.json();
        setCapabilities({
          provider: data.provider || 'resend',
          autoTracking: Boolean(data.autoTracking),
        });
      }
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => {
    loadConfig();
    loadLeads();
    const id = setInterval(loadLeads, 30_000);
    return () => clearInterval(id);
  }, [loadLeads, loadConfig]);

  async function handleGeneratePreview(e) {
    e.preventDefault();
    setErr('');
    setBusy(true);
    setPreview(null);
    try {
      const r = await api('/api/preview', {
        method: 'POST',
        body: JSON.stringify({ name, email, company, role }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Preview failed');
      setPreview({ subject: data.subject, body: data.body });
    } catch (e) {
      setErr(e.message || 'Preview failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirmSend() {
    if (!preview) return;
    setErr('');
    setBusy(true);
    try {
      const r = await api('/api/leads', {
        method: 'POST',
        body: JSON.stringify({
          name,
          email,
          company,
          role,
          subject: preview.subject,
          body: preview.body,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Send failed');
      if (data.send && !data.send.success) {
        setErr(data.send.error || 'Resend rejected the email');
      }
      setPreview(null);
      await loadLeads();
    } catch (e) {
      setErr(e.message || 'Send failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(em) {
    if (!confirm(`Remove ${em} from the list?`)) return;
    try {
      const r = await api(`/api/leads/${encodeURIComponent(em)}`, { method: 'DELETE' });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        throw new Error(data.error || 'Delete failed');
      }
      await loadLeads();
    } catch (e) {
      setErr(e.message || 'Delete failed');
    }
  }

  async function handleSaveLogReply() {
    if (!logReplyFor) return;
    const text = logReplyText.trim();
    if (!text) {
      setErr('Paste the reply text from Gmail first.');
      return;
    }
    setErr('');
    setBusy(true);
    try {
      const r = await api(`/api/leads/${encodeURIComponent(logReplyFor.email)}/log-reply`, {
        method: 'POST',
        body: JSON.stringify({ replyContent: text }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || 'Could not save reply');
      setLogReplyFor(null);
      setLogReplyText('');
      await loadLeads();
    } catch (e) {
      setErr(e.message || 'Could not save reply');
    } finally {
      setBusy(false);
    }
  }

  const fullReply =
    replyLead &&
    (replyLead.replyContentFull || replyLead.replyContent || '(No content)');

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-6xl px-4 py-10">
        <header className="mb-10 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-white">Cold outreach</h1>
            <p className="mt-1 text-sm text-zinc-400">
              {capabilities == null
                ? 'Loading mail settings…'
                : capabilities.provider === 'gmail'
                  ? 'Groq draft → Gmail send — check Gmail for replies; log them here with “Log reply”.'
                  : 'Groq draft → Resend send → live opens, clicks, and replies'}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {lastRefresh && (
              <span className="text-xs text-zinc-500">
                Updated {lastRefresh.toLocaleTimeString()}
              </span>
            )}
            <button
              type="button"
              onClick={() => loadLeads()}
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-800"
            >
              Refresh
            </button>
          </div>
        </header>

        {err && (
          <div className="mb-6 rounded-lg border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-200">
            {err}
          </div>
        )}

        {capabilities?.provider === 'gmail' && (
          <div className="mb-6 rounded-lg border border-amber-900/50 bg-amber-950/20 px-4 py-3 text-sm text-amber-100/90">
            <strong className="text-amber-200">Gmail mode:</strong> mail is sent through your Google
            account. Open and click tracking are not available. When someone replies, it appears only
            in Gmail — use <strong>Log reply</strong> on a row to paste their message into this
            dashboard.
          </div>
        )}

        <section className="mb-10 rounded-xl border border-zinc-800 bg-zinc-900/40 p-6">
          <h2 className="mb-4 text-sm font-medium uppercase tracking-wide text-zinc-500">
            New lead
          </h2>
          <form onSubmit={handleGeneratePreview} className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="text-zinc-400">Name</span>
              <input
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100 outline-none ring-violet-500 focus:ring-1"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Jordan Lee"
              />
            </label>
            <label className="block text-sm">
              <span className="text-zinc-400">Email</span>
              <input
                required
                type="email"
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100 outline-none ring-violet-500 focus:ring-1"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="jordan@studio.com"
              />
            </label>
            <label className="block text-sm">
              <span className="text-zinc-400">Company</span>
              <input
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100 outline-none ring-violet-500 focus:ring-1"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                placeholder="Immersive Games Ltd"
              />
            </label>
            <label className="block text-sm">
              <span className="text-zinc-400">Role</span>
              <input
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100 outline-none ring-violet-500 focus:ring-1"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                placeholder="Lead XR Engineer"
              />
            </label>
            <div className="sm:col-span-2">
              <button
                type="submit"
                disabled={busy}
                className="rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-50"
              >
                {busy ? 'Working…' : 'Generate & send email'}
              </button>
              <p className="mt-2 text-xs text-zinc-500">
                Step 1: generates a preview. Step 2: confirm send below.
              </p>
            </div>
          </form>

          {preview && (
            <div className="mt-8 border-t border-zinc-800 pt-8">
              <h3 className="mb-3 text-sm font-medium text-zinc-300">Preview</h3>
              <p className="mb-2 text-xs text-zinc-500">Subject</p>
              <p className="mb-4 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white">
                {preview.subject}
              </p>
              <p className="mb-2 text-xs text-zinc-500">Body</p>
              <pre className="mb-6 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border border-zinc-800 bg-zinc-950 p-4 text-sm text-zinc-200">
                {preview.body}
              </pre>
              <button
                type="button"
                disabled={busy}
                onClick={handleConfirmSend}
                className="rounded-lg border border-violet-500/50 bg-violet-950/30 px-4 py-2.5 text-sm font-semibold text-violet-200 hover:bg-violet-950/50 disabled:opacity-50"
              >
                Confirm send
              </button>
            </div>
          )}
        </section>

        <section>
          <h2 className="mb-4 text-sm font-medium uppercase tracking-wide text-zinc-500">
            Leads
          </h2>
          <div className="overflow-x-auto rounded-xl border border-zinc-800">
            <table className="w-full min-w-[880px] text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-800 bg-zinc-900/60 text-xs uppercase tracking-wide text-zinc-500">
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Company</th>
                  <th className="px-4 py-3 font-medium">Role</th>
                  <th className="px-4 py-3 font-medium">Subject</th>
                  <th className="px-4 py-3 font-medium">Sent</th>
                  <th className="px-4 py-3 font-medium">Opened</th>
                  <th className="px-4 py-3 font-medium">Clicked</th>
                  <th className="px-4 py-3 font-medium">Replied</th>
                  <th className="px-4 py-3 font-medium">Time</th>
                  <th className="px-4 py-3 font-medium" />
                </tr>
              </thead>
              <tbody>
                {leads.length === 0 && (
                  <tr>
                    <td colSpan={10} className="px-4 py-8 text-center text-zinc-500">
                      No leads yet. Generate a preview and send your first email.
                    </td>
                  </tr>
                )}
                {leads.map((lead) => (
                  <tr
                    key={lead.email}
                    className="border-b border-zinc-800/80 last:border-0 hover:bg-zinc-900/30"
                  >
                    <td className="px-4 py-3 text-zinc-200">{lead.name || '—'}</td>
                    <td className="px-4 py-3 text-zinc-300">{lead.company || '—'}</td>
                    <td className="px-4 py-3 text-zinc-400">{lead.role || '—'}</td>
                    <td className="max-w-[200px] truncate px-4 py-3 text-zinc-300" title={lead.subject}>
                      {lead.subject || '—'}
                    </td>
                    <td className="px-4 py-3">
                      {lead.bounced ? (
                        <Badge className="bg-red-950 text-red-300 ring-1 ring-red-800/80" title={lead.bounceNote || ''}>
                          Bounced
                        </Badge>
                      ) : lead.sent ? (
                        <Badge className="bg-blue-950 text-blue-200 ring-1 ring-blue-800/60">Sent</Badge>
                      ) : (
                        <Badge className="bg-zinc-800 text-zinc-400">No</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {capabilities && !capabilities.autoTracking ? (
                        <span className="text-zinc-600" title="Not available with Gmail">
                          N/A
                        </span>
                      ) : lead.opened ? (
                        <Badge className="bg-amber-950 text-amber-200 ring-1 ring-amber-800/60">
                          Opened
                        </Badge>
                      ) : (
                        <span className="text-zinc-600">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {capabilities && !capabilities.autoTracking ? (
                        <span className="text-zinc-600" title="Not available with Gmail">
                          N/A
                        </span>
                      ) : lead.clicked ? (
                        <Badge className="bg-emerald-950 text-emerald-200 ring-1 ring-emerald-800/60">
                          Clicked
                        </Badge>
                      ) : (
                        <span className="text-zinc-600">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {lead.replied ? (
                        <div className="flex flex-col gap-1">
                          <Badge className="bg-purple-950 text-purple-200 ring-1 ring-purple-800/60">
                            Replied
                          </Badge>
                          <button
                            type="button"
                            onClick={() => setReplyLead(lead)}
                            className="text-left text-xs text-violet-400 hover:text-violet-300"
                          >
                            View reply
                          </button>
                        </div>
                      ) : capabilities?.provider === 'gmail' ? (
                        <button
                          type="button"
                          onClick={() => {
                            setLogReplyFor(lead);
                            setLogReplyText('');
                          }}
                          className="text-left text-xs text-zinc-400 hover:text-violet-400"
                        >
                          Log reply
                        </button>
                      ) : (
                        <span className="text-zinc-600">—</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-zinc-500">
                      {formatTime(lead.timestamp)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1">
                        {capabilities?.provider === 'gmail' && lead.replied && (
                          <button
                            type="button"
                            onClick={() => {
                              setLogReplyFor(lead);
                              setLogReplyText(lead.replyContentFull || lead.replyContent || '');
                            }}
                            className="text-left text-xs text-zinc-500 hover:text-violet-400"
                          >
                            Edit reply
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleDelete(lead.email)}
                          className="text-left text-xs text-zinc-500 hover:text-red-400"
                        >
                          Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {logReplyFor && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setLogReplyFor(null);
              setLogReplyText('');
            }
          }}
        >
          <div className="max-h-[90vh] w-full max-w-lg overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 shadow-xl">
            <div className="border-b border-zinc-800 px-5 py-4">
              <h3 className="text-lg font-semibold text-white">Log reply from Gmail</h3>
              <p className="mt-1 text-sm text-zinc-400">
                {logReplyFor.name || 'Lead'} · {logReplyFor.email}
              </p>
              <p className="mt-2 text-xs text-zinc-500">
                Copy the reply from your Gmail thread and paste it below.
              </p>
            </div>
            <div className="px-5 py-4">
              <textarea
                className="h-48 w-full resize-y rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none ring-violet-500 focus:ring-1"
                value={logReplyText}
                onChange={(e) => setLogReplyText(e.target.value)}
                placeholder="Paste reply text…"
              />
            </div>
            <div className="flex justify-end gap-2 border-t border-zinc-800 px-5 py-3">
              <button
                type="button"
                onClick={() => {
                  setLogReplyFor(null);
                  setLogReplyText('');
                }}
                className="rounded-lg bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-700"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={handleSaveLogReply}
                className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-50"
              >
                {busy ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {replyLead && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) setReplyLead(null);
          }}
        >
          <div className="max-h-[85vh] w-full max-w-lg overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 shadow-xl">
            <div className="border-b border-zinc-800 px-5 py-4">
              <h3 className="text-lg font-semibold text-white">Reply</h3>
              <p className="mt-1 text-sm text-zinc-400">
                {replyLead.name || 'Lead'} · {replyLead.email}
              </p>
              <p className="mt-1 text-xs text-zinc-500">
                {replyLead.replyAt ? formatTime(replyLead.replyAt) : formatTime(replyLead.timestamp)}
              </p>
            </div>
            <div className="max-h-[50vh] overflow-auto px-5 py-4">
              <p className="text-xs uppercase tracking-wide text-zinc-500">Full reply content</p>
              <pre className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-zinc-200">
                {fullReply}
              </pre>
            </div>
            <div className="flex justify-end border-t border-zinc-800 px-5 py-3">
              <button
                type="button"
                onClick={() => setReplyLead(null)}
                className="rounded-lg bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-700"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
