/**
 * Small shared pieces: time, text, the orchestrator wait, the local model, and WordPress's own
 * status names and entities.
 */

export function stripHtml(text) {
  return String(text || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function ago(iso) {
  if (!iso) return 'at some point';
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 90) return 'just now';
  const minutes = seconds / 60;
  if (minutes < 60) return `${Math.round(minutes)}m ago`;
  const hours = minutes / 60;
  if (hours < 24) return `${Math.round(hours)}h ago`;
  const days = hours / 24;
  if (days < 30) return `${Math.round(days)}d ago`;
  return new Date(iso).toISOString().slice(0, 10);
}

export async function waitForTask(api, id, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    const t = await api(`/api/orchestrator/task?id=${id}`).catch(() => null);
    if (!t) continue;
    if (t.state === 'completed') return t.result || '(finished with nothing to say)';
    if (['failed', 'cancelled', 'timeout'].includes(t.state)) return t.error || `The worker ${t.state}.`;
  }
  return 'It is taking too long; the answer will land in the orchestrator.';
}

/** The local model first, then a spawned CLI. Returns the text, stripped of the bootstrap tag. */
export async function askModel(api, { prompt, system, maxTokens = 900, from = 'wordpress', timeout = 180000 }) {
  let text = '';
  try { text = String((await api('/api/notes/ai', { method: 'POST', body: JSON.stringify({ prompt, system, maxTokens }) })).text || '').trim(); } catch (_) {}
  if (!text) {
    const cfg = await api('/api/config').catch(() => ({}));
    const result = await api('/api/orchestrator/spawn', { method: 'POST', body: JSON.stringify({ cli: cfg.DefaultCli || 'claude', from, timeout, prompt: `${system}\n\n${prompt}\n\nThis is a one-off answer: do not run any bootstrap, do not save anything to Mind or any memory, do not mention either. Reply with the answer only.` }) });
    text = String(result.handledLocally ? result.answer : result.id ? await waitForTask(api, result.id, timeout) : (result.error || '')).replace(/^\s*\[bootstrap:[^\]]*\]\s*/, '').trim();
  }
  return text;
}

export const bytes = (n) => (!n ? '' : n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n > 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);
export const decode = (t) => { const el = document.createElement('textarea'); el.innerHTML = String(t || ''); return el.value; };
export const STATUS = { publish: 'published', draft: 'draft', pending: 'pending review', future: 'scheduled', private: 'private', trash: 'trashed', 'auto-draft': 'auto draft', inherit: 'inherit' };
export const statusLabel = (s) => STATUS[s] || s || '';
export const statusColour = (s) => (s === 'publish' ? 'var(--sy-moss)' : s === 'future' ? 'var(--sy-brass)' : s === 'pending' ? 'var(--sy-brass)' : s === 'draft' ? 'var(--sy-rosin)' : s === 'private' ? 'var(--sy-text-2)' : 'var(--sy-text-3)');
export const builderLabel = (b) => (b === 'elementor' ? 'Elementor' : b === 'breakdance' ? 'Breakdance' : b === 'bricks' ? 'Bricks' : b === 'beaver' ? 'Beaver Builder' : b === 'divi' ? 'Divi' : b === 'gutenberg' ? 'Blocks' : b === 'classic' ? 'Classic' : 'empty');
