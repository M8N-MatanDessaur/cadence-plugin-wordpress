/**
 * Ask, as a bento: a question about the site, answered by the AI from read-only routes.
 */
import { waitForTask } from './helpers.js';
import { Panel, Health, List, ListRow, FILL } from './kit.js';

const RECENT_KEY = 'sy.wp.ask.recent';
const readRecent = () => { try { const v = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
const writeRecent = (list) => { try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 20))); } catch {} };
const when = (at) => new Date(at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const short = (s, n = 64) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}...` : s);

function prepare({ health }) {
  const d = health.data;
  if (!d) return [];
  const out = [];
  if (d.counts.drafts) out.push({ q: 'Which drafts look ready to publish, and which are abandoned?', why: `${d.counts.drafts} drafts` });
  out.push({ q: 'Which published pages have no meta description, and what would you write for each?', why: 'SEO' });
  if (d.counts.pendingComments) out.push({ q: 'Summarise the comments awaiting moderation and say which look like spam.', why: `${d.counts.pendingComments} waiting` });
  out.push({ q: 'What changed in the last two weeks, and in which types?', why: 'recent activity' });
  out.push({ q: 'List every page with its URL and say which ones look thin or outdated.', why: 'content audit' });
  if ((d.plugins || []).some((p) => p.id === 'woocommerce')) out.push({ q: 'Which products have no description, no image or no category?', why: 'WooCommerce' });
  out.push({ q: 'Summarise the site: what it is about, its main pages, its tone, its audience.', why: 'orientation' });
  return out.slice(0, 7);
}

export function Ask({ host, api: API, site, health, onOpen }) {
  const { h, ui, api, react, icons } = host;
  const { useState, useEffect, useMemo } = react;
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [recent, setRecent] = useState(readRecent);
  useEffect(() => { if (!asking) { setElapsed(0); return undefined; } const started = Date.now(); const t = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000); return () => clearInterval(t); }, [asking]);
  const suggestions = useMemo(() => prepare({ health }), [health.data]);
  const meta = (text) => h('span', { className: 'mpanel__meta' }, text);
  const ask = async (text) => {
    const asked = (text || question).trim();
    if (!asked || asking) return;
    setQuestion(asked); setAsking(true); setAnswer(null);
    const started = Date.now();
    try {
      const cfg = await api('/api/config').catch(() => ({}));
      const base = window.location.origin;
      const sp = `site=${encodeURIComponent(site)}`;
      const prompt = [
        `Answer a question about the WordPress site "${site}". Today is ${new Date().toISOString().slice(0, 10)}.`,
        'Read from these READ-ONLY routes on the local Cadence server (plain GET with curl). Never call POST, PUT, PATCH or DELETE; never publish, edit, moderate or delete anything.',
        `  ${base}${API}/health?${sp}                                      post types with counts, drafts, pending, comments, media, plugins, recent items, issues`,
        `  ${base}${API}/summary?${sp}                                     plain-text summary`,
        `  ${base}${API}/entries?type=<restBase>&q=&status=&page=&${sp}     items of a type, one row each, with SEO title and description, builder, word count`,
        `  ${base}${API}/item?type=<restBase>&id=<id>&${sp}                one item in full: content, excerpt, terms, featured image, SEO, layout summary`,
        `  ${base}${API}/insights?${sp}                                    every item with a problem (drafts, pending, stale, SEO, noindex, thin, no image)`,
        `  ${base}${API}/comments?status=hold&${sp}                        comments awaiting moderation`,
        `  ${base}${API}/terms/<restBase>?${sp}                            terms of a taxonomy`,
        `  ${base}${API}/media?per_page=&search=&${sp}                     the library`,
        '', `Question: ${asked}`, '',
        'Answer in Markdown from what you read only: a short lead, then bold labels, bullets or a table. Name items as "<type>: <title>" and give their id and rest base so they can be opened. Say plainly if the data does not cover it.',
        'This is a one-off answer, not a session: do not run any bootstrap, do not save to Mind or any memory, do not mention either. Reply with the answer only.',
      ].join('\n');
      const result = await api('/api/orchestrator/spawn', { method: 'POST', body: JSON.stringify({ cli: cfg.DefaultCli || 'claude', from: 'wordpress-ask', timeout: 300000, prompt }) });
      const text = result.handledLocally ? (result.answer || '(no answer)') : result.id ? await waitForTask(api, result.id, 300000) : (result.error || 'No answer came back.');
      const entry = { question: asked, answer: String(text).replace(/^\s*\[bootstrap:[^\]]*\]\s*/, '').trim(), at: new Date().toISOString(), seconds: Math.round((Date.now() - started) / 1000) };
      setAnswer(entry); const next = [entry, ...recent.filter((e) => e.question !== asked)]; writeRecent(next); setRecent(next);
    } catch (e) { setAnswer({ question: asked, answer: e.message, at: new Date().toISOString(), seconds: 0 }); } finally { setAsking(false); }
  };
  const d = health.data;
  const answerPanel = asking
    ? Panel(host, { title: 'Reading the site', action: meta(`${elapsed}s`), ...FILL }, h('p', { className: 'mlead', style: { margin: '0 0 var(--sy-s3)' } }, 'The AI is reading the content, then writing the answer.'), h(ui.Skeleton, { count: 5, height: 16 }))
    : !answer
      ? Panel(host, { title: 'Answer', action: meta('nothing asked yet'), ...FILL },
        h('p', { className: 'mlead', style: { margin: '0 0 var(--sy-s3)' } }, 'The AI reads the site through this plugin for whatever the question needs and answers from what it read. It never publishes, edits or moderates.'),
        h('div', { className: 'mhealth' }, Health(host, { label: 'items', value: d ? `${d.types.filter((t) => !t.internal && t.slug !== 'attachment').reduce((n, t) => n + t.total, 0)}` : '...', tone: 'brass' }), Health(host, { label: 'drafts', value: d ? `${d.counts.drafts}` : '...' }), Health(host, { label: 'media', value: d ? `${d.counts.media}` : '...' })))
      : Panel(host, { title: 'Answer', ...FILL, action: meta(`${when(answer.at)} - ${answer.seconds}s`) }, h('p', { className: 'mlead', style: { margin: '0 0 var(--sy-s3)' } }, answer.question), h(ui.Markdown, { source: answer.answer }));
  const column = (...children) => h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)', minWidth: 0, minHeight: 0 } }, ...children);
  return h('div', { className: 'wp-ask', style: { flex: 1, minHeight: 0 } },
    column(
      Panel(host, { title: 'Ask about the site', action: meta(site || 'no site') },
        h('div', { style: { display: 'flex', gap: 8 } },
          h(ui.Input, { placeholder: '"which pages mention financing?" or "what is still a draft?"', value: question, disabled: asking, onChange: (e) => setQuestion(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter') ask(); }, 'aria-label': 'Question' }),
          h(ui.Button, { variant: 'primary', disabled: asking || !question.trim(), onClick: () => ask() }, asking ? `Asking... ${elapsed}s` : 'Ask'))),
      answerPanel),
    column(
      Panel(host, { title: 'Worth asking', action: meta('from the site') },
        suggestions.length ? List(host, suggestions.map((s) => ListRow(host, { key: s.q, lead: h(icons.search, { size: 13, style: { opacity: 0.6, flex: 'none' } }), label: s.q, sub: s.why, onClick: asking ? undefined : () => ask(s.q) }))) : h('p', { className: 'mlead', style: { margin: 0 } }, 'Reading the site...')),
      Panel(host, { title: 'Recently asked', ...FILL, action: recent.length ? h('button', { type: 'button', className: 'mpanel__meta', style: { background: 'none', border: 0, cursor: 'pointer', padding: 0 }, onClick: () => { writeRecent([]); setRecent([]); } }, 'forget all') : meta('kept in the app') },
        recent.length ? List(host, recent.map((e) => ListRow(host, { key: e.at, lead: h(icons.history, { size: 13, style: { opacity: 0.6, flex: 'none' } }), label: short(e.question), sub: `${when(e.at)} - ${e.seconds}s`, onClick: () => { setQuestion(e.question); setAnswer(e); } }))) : h('p', { className: 'mlead', style: { margin: 0 } }, 'Nothing asked yet. Every answer is kept here and comes back in one click.'))));
}
