/**
 * Comments: moderation as a list. Approve, hold, spam, trash, reply; filter by status.
 */
import { ago, stripHtml, decode } from './helpers.js';
import { Panel, Stat, Health, List, ListRow } from './kit.js';

const STATUSES = [['hold', 'Waiting'], ['approve', 'Approved'], ['spam', 'Spam'], ['trash', 'Trash'], ['all', 'All']];
const tone = (s) => (s === 'approved' ? 'var(--sy-moss)' : s === 'hold' ? 'var(--sy-brass)' : s === 'spam' ? 'var(--sy-rosin)' : 'var(--sy-text-3)');

export function Comments({ host, wp, site, health, q, onOpenItem, onChanged }) {
  const { h, ui, notify, tokens } = host;
  const { useState, useEffect } = host.react;
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('hold');
  const [reply, setReply] = useState(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(null);
  const load = () => { setData(null); wp(`/comments?status=${status}&per_page=50&search=${encodeURIComponent(q || '')}&_fields=id,post,parent,author_name,author_email,author_avatar_urls,date,content,status,link`).then(setData).catch((e) => setData({ error: e.message, items: [] })); };
  useEffect(load, [status, q, site]);
  const meta = (t) => h('span', { className: 'mpanel__meta' }, t);
  const empty = (t) => h('p', { className: 'mlead', style: { margin: 0 } }, t);
  const list = data ? data.items || [] : [];
  const act = async (id, action) => { setBusy(`${id}-${action}`); try { const r = await wp(`/comments/${id}/${action}`, { method: 'POST', body: '{}' }); if (r && r.code) throw new Error(r.message || r.code); notify(action === 'approve' ? 'Approved' : action === 'hold' ? 'On hold' : action === 'spam' ? 'Marked as spam' : 'Trashed', 'moss'); load(); onChanged(); } catch (e) { notify(e.message, 'rosin'); } finally { setBusy(null); } };
  const send = async () => { if (!reply || !text.trim()) return; setBusy('reply'); try { const r = await wp('/comments', { method: 'POST', body: JSON.stringify({ post: reply.post, parent: reply.id, content: text.trim() }) }); if (r && r.code) throw new Error(r.message || r.code); notify('Reply posted', 'moss'); setReply(null); setText(''); load(); } catch (e) { notify(e.message, 'rosin'); } finally { setBusy(null); } };
  const counts = health.data ? health.data.counts : null;
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)' } },
    h('div', { className: 'mstats mstats--head' },
      Stat(host, { label: 'Awaiting moderation', value: counts ? counts.pendingComments : '...', tone: counts && counts.pendingComments ? 'brass' : 'moss' }),
      Stat(host, { label: 'Shown', value: !data ? '...' : list.length, tone: 'muted', hint: data && data.total ? `of ${data.total}` : undefined }),
      Stat(host, { label: 'Filter', value: STATUSES.find(([k]) => k === status)[1], tone: 'muted' }),
      Stat(host, { label: 'Replying', value: reply ? 'yes' : 'no', tone: reply ? 'brass' : 'muted' })),
    reply ? Panel(host, { title: `Reply to ${reply.author_name || 'anonymous'}`, wide: true, action: meta('posts publicly, as the connected user') },
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
        h('p', { className: 'mlead', style: { margin: 0 } }, stripHtml(decode(reply.content && reply.content.rendered)).slice(0, 400)),
        h(ui.Textarea, { value: text, rows: 4, placeholder: 'Your reply', onChange: (e) => setText(e.target.value), autoFocus: true }),
        h('div', { style: { display: 'flex', gap: 8 } }, h(ui.Button, { onClick: () => { setReply(null); setText(''); } }, 'Cancel'), h('span', { style: { flex: 1 } }), h(ui.Button, { variant: 'primary', disabled: busy === 'reply' || !text.trim(), onClick: send }, busy === 'reply' ? 'Posting...' : 'Post the reply')))) : null,
    Panel(host, { title: 'Comments', wide: true, action: h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } }, STATUSES.map(([k, l]) => h(ui.Chip, { key: k, on: status === k, onClick: () => setStatus(k) }, l))) },
      !data ? h(ui.Skeleton, { count: 6, height: 18 }) : data.error ? empty(data.error) : list.length ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 640, overflow: 'auto', paddingRight: 14, scrollbarGutter: 'stable' } },
        list.map((c) => h('div', { key: c.id, style: { padding: '10px 12px', border: `1px solid ${tokens('line')}`, borderRadius: 8, background: 'var(--sy-surface)' } },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 } },
            c.author_avatar_urls && c.author_avatar_urls['48'] ? h('img', { src: c.author_avatar_urls['48'], alt: '', width: 22, height: 22, style: { borderRadius: '50%' } }) : h('span', { className: 'mind-dot', style: { background: tone(c.status) } }),
            h('span', { style: { fontWeight: 600, fontSize: 'var(--sy-fs-sm)' } }, c.author_name || 'anonymous'),
            c.author_email ? h('span', { className: 'mpanel__meta' }, c.author_email) : null,
            h('span', { className: 'mpanel__meta' }, `${c.status} - ${ago(c.date)}`),
            h('span', { style: { flex: 1 } }),
            h('button', { type: 'button', className: 'mpanel__meta', style: { background: 'none', border: 0, cursor: 'pointer', padding: 0 }, onClick: () => onOpenItem('posts', c.post) }, `on post #${c.post}`)),
          h('p', { style: { margin: '0 0 8px', fontSize: 'var(--sy-fs-sm)', lineHeight: 1.5 } }, stripHtml(decode(c.content && c.content.rendered)).slice(0, 600)),
          h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
            c.status !== 'approved' ? h(ui.Button, { className: 'sy-btn--sm', variant: 'primary', disabled: !!busy, onClick: () => act(c.id, 'approve') }, busy === `${c.id}-approve` ? '...' : 'Approve') : null,
            c.status !== 'hold' ? h(ui.Button, { className: 'sy-btn--sm', disabled: !!busy, onClick: () => act(c.id, 'hold') }, 'Hold') : null,
            c.status !== 'spam' ? h(ui.Button, { className: 'sy-btn--sm', disabled: !!busy, onClick: () => act(c.id, 'spam') }, 'Spam') : null,
            c.status !== 'trash' ? h(ui.Button, { className: 'sy-btn--sm', disabled: !!busy, onClick: () => act(c.id, 'trash') }, 'Trash') : null,
            h(ui.Button, { className: 'sy-btn--sm', onClick: () => { setReply(c); setText(''); } }, 'Reply')))))
        : empty(status === 'hold' ? 'Nothing waits for moderation.' : 'Nothing of that kind.')));
}

export function CommentsAside({ host, health }) {
  const { h } = host;
  const c = health.data ? health.data.counts : null;
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)' } },
    Panel(host, { title: 'Moderation' }, h('p', { className: 'mlead', style: { margin: 0 } }, 'Waiting comments are not on the site. Approve puts one live; Hold takes it back; Spam trains the filter; Trash keeps it thirty days. A reply posts publicly under the connected user.')),
    c ? Panel(host, { title: 'Now' }, h('p', { className: 'mlead', style: { margin: 0 } }, c.pendingComments ? `${c.pendingComments} comment${c.pendingComments === 1 ? '' : 's'} waiting.` : 'Nothing waiting.')) : null);
}
