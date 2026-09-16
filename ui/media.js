/**
 * Media: the library as a grid, one file selected on the right with where it is used, its
 * alt text, title and caption (editable), an upload from a URL, and Delete for the unused.
 */
import { ago, bytes, statusColour, statusLabel } from './helpers.js';
import { Panel, Stat, Health, List, ListRow, FILL } from './kit.js';
import { restBaseOf } from './overview.js';

const thumb = (a) => (a.media_details && a.media_details.sizes && (a.media_details.sizes.medium || a.media_details.sizes.thumbnail) ? (a.media_details.sizes.medium || a.media_details.sizes.thumbnail).source_url : a.source_url);
const isImg = (a) => /^image\//.test(a.mime_type || '');

export function Media({ host, wp, site, health, q, selected, onSelect }) {
  const { h, ui, tokens, notify } = host;
  const { useState, useEffect } = host.react;
  const [data, setData] = useState(null);
  const [kind, setKind] = useState('all');
  const [page, setPage] = useState(1);
  const [url, setUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  useEffect(() => { setPage(1); }, [q, site, kind]);
  useEffect(() => { setData(null); wp(`/media?per_page=48&page=${page}${kind !== 'all' ? `&media_type=${kind}` : ''}&search=${encodeURIComponent(q || '')}&_fields=id,title,alt_text,source_url,mime_type,media_details,date,caption`).then((d) => setData(d)).catch((e) => setData({ error: e.message, items: [] })); }, [q, page, site, kind, selected && selected._bump]);
  const meta = (text) => h('span', { className: 'mpanel__meta' }, text);
  const empty = (text) => h('p', { className: 'mlead', style: { margin: 0 } }, text);
  const list = data ? data.items || [] : [];
  const total = data ? Number(data.total || 0) : 0;
  const upload = async () => { if (!url.trim()) return; setUploading(true); try { const r = await wp('/media/upload-url', { method: 'POST', body: JSON.stringify({ url: url.trim() }) }); if (!r || !r.id) throw new Error((r && (r.error || r.message)) || 'Upload failed'); notify('Uploaded', 'moss'); setUrl(''); setPage(1); onSelect({ ...r, _bump: Date.now() }); } catch (e) { notify(e.message, 'rosin'); } finally { setUploading(false); } };
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)' } },
    h('div', { className: 'mstats mstats--head' },
      Stat(host, { label: 'Matching', value: !data ? '...' : total, tone: 'brass', hint: q ? 'searching the library' : 'newest first' }),
      Stat(host, { label: 'In the library', value: !health.data ? '...' : health.data.counts.media, tone: 'muted' }),
      Stat(host, { label: 'Images without alt', value: !health.data || health.data.counts.imagesNoAlt === null ? '...' : health.data.counts.imagesNoAlt, tone: health.data && health.data.counts.imagesNoAlt ? 'brass' : 'muted', hint: health.data && health.data.counts.imagesNoAlt === null ? 'counted when Insights runs' : 'across the library' }),
      Stat(host, { label: 'On this page', value: !data ? '...' : bytes(list.reduce((n, a) => n + ((a.media_details && a.media_details.filesize) || 0), 0)) || '-', tone: 'muted' })),
    Panel(host, { title: 'Add from a URL', wide: true, action: meta('the server downloads it, then uploads it to the site') },
      h('div', { style: { display: 'flex', gap: 8 } }, h(ui.Input, { value: url, placeholder: 'https://.../image.jpg', onChange: (e) => setUrl(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter') upload(); } }), h(ui.Button, { variant: 'primary', disabled: uploading || !url.trim(), onClick: upload }, uploading ? 'Uploading...' : 'Upload'))),
    Panel(host, { title: 'Library', wide: true, action: h('div', { style: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' } },
      [['all', 'All'], ['image', 'Images'], ['video', 'Video'], ['application', 'Documents']].map(([k, l]) => h(ui.Chip, { key: k, on: kind === k, onClick: () => setKind(k) }, l)),
      page > 1 ? h(ui.Button, { className: 'sy-btn--sm', onClick: () => setPage(page - 1) }, 'Newer') : null,
      data && page < Number(data.totalPages || 1) ? h(ui.Button, { className: 'sy-btn--sm', onClick: () => setPage(page + 1) }, 'Older') : null,
      meta(data ? `${total ? (page - 1) * 48 + 1 : 0}-${(page - 1) * 48 + list.length} of ${total}` : '')) },
      !data ? h(ui.Skeleton, { count: 6, height: 18 }) : data.error ? empty(data.error) : list.length ? h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 } },
        list.map((a) => h('button', { key: a.id, type: 'button', onClick: () => onSelect(a), title: (a.title && a.title.rendered) || a.id, style: { textAlign: 'left', padding: 0, border: `1px solid ${selected && selected.id === a.id ? 'var(--sy-brass)' : tokens('line')}`, borderRadius: 8, background: 'var(--sy-surface)', cursor: 'pointer', overflow: 'hidden', color: 'inherit', font: 'inherit' } },
          h('div', { style: { height: 96, background: 'rgba(255,255,255,0.03)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' } }, isImg(a) ? h('img', { src: thumb(a), alt: '', loading: 'lazy', style: { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' } }) : h('span', { className: 'mpanel__meta' }, (a.mime_type || 'file').split('/').pop())),
          h('div', { style: { padding: '6px 8px' } }, h('div', { style: { fontSize: 'var(--sy-fs-sm)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, (a.title && a.title.rendered) || a.id), h('div', { className: 'mpanel__meta' }, `${a.media_details && a.media_details.width ? `${a.media_details.width}x${a.media_details.height} - ` : ''}${bytes(a.media_details && a.media_details.filesize)}${isImg(a) && !a.alt_text ? ' - no alt' : ''}`)))))
        : empty(q ? 'Nothing matches.' : 'The library is empty.')));
}

export function MediaAside({ host, wp, site, selected, onOpenItem, onChanged, onCleared }) {
  const { h, ui, notify } = host;
  const { useState, useEffect } = host.react;
  const [usage, setUsage] = useState(null);
  const [alt, setAlt] = useState('');
  const [title, setTitle] = useState('');
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(null);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => { setUsage(null); setConfirm(false); setAlt(selected ? selected.alt_text || '' : ''); setTitle(selected ? (selected.title && (selected.title.raw != null ? selected.title.raw : selected.title.rendered)) || '' : ''); setCaption(selected ? (selected.caption && (selected.caption.raw != null ? selected.caption.raw : '')) || '' : ''); if (selected) wp(`/media/${selected.id}/usage`).then((d) => setUsage(d.items || [])).catch(() => setUsage([])); }, [selected && selected.id, site]);
  const meta = (text) => h('span', { className: 'mpanel__meta' }, text);
  if (!selected) return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)' } }, Panel(host, { title: 'This file' }, h('p', { className: 'mlead', style: { margin: 0 } }, 'Pick a file to see where it is used, set its alt text, title and caption, or delete it when nothing uses it.')));
  const save = async () => { setBusy('save'); try { const r = await wp(`/media/${selected.id}`, { method: 'PUT', body: JSON.stringify({ alt_text: alt, title, caption }) }); if (r && r.code) throw new Error(r.message || r.code); notify('Updated', 'moss'); onChanged(); } catch (e) { notify(e.message, 'rosin'); } finally { setBusy(null); } };
  const remove = async () => { setBusy('delete'); try { const r = await wp(`/media/${selected.id}`, { method: 'DELETE' }); if (r && r.code) throw new Error(r.message || r.code); notify('Deleted', 'moss'); onCleared(); } catch (e) { notify(e.message, 'rosin'); } finally { setBusy(null); setConfirm(false); } };
  const md = selected.media_details || {};
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)', flex: 1, minHeight: 0, height: '100%' } },
    Panel(host, { title: 'This file', action: h('a', { className: 'mpanel__meta', href: selected.source_url, target: '_blank', rel: 'noreferrer' }, 'open') },
      isImg(selected) ? h('img', { src: thumb(selected), alt: '', style: { width: '100%', maxHeight: 180, objectFit: 'contain', borderRadius: 6, background: 'rgba(255,255,255,0.03)', marginBottom: 'var(--sy-s2)' } }) : null,
      h(ui.InfoGrid, { items: [{ label: 'File', value: (md.file || selected.source_url || '').split('/').pop() }, { label: 'Type', value: selected.mime_type || '-' }, { label: 'Size', value: `${md.width ? `${md.width}x${md.height}, ` : ''}${bytes(md.filesize) || '-'}` }, { label: 'Uploaded', value: selected.date ? ago(selected.date) : '-' }, { label: 'Id', value: selected.id }] })),
    Panel(host, { title: 'On the file', action: meta('alt text, title, caption') },
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
        h(ui.Field, { label: 'Alt text' }, h(ui.Input, { value: alt, placeholder: 'What the image shows', onChange: (e) => setAlt(e.target.value) })),
        h(ui.Field, { label: 'Title' }, h(ui.Input, { value: title, onChange: (e) => setTitle(e.target.value) })),
        h(ui.Field, { label: 'Caption' }, h(ui.Input, { value: caption, onChange: (e) => setCaption(e.target.value) })),
        h('div', null, h(ui.Button, { className: 'sy-btn--sm', variant: 'primary', disabled: busy === 'save', onClick: save }, busy === 'save' ? 'Saving...' : 'Save')))),
    Panel(host, { title: 'Used in', ...FILL, action: meta(usage === null ? 'searching...' : `${usage.length}`) },
      usage === null ? h(ui.Skeleton, { count: 3, height: 16 }) : usage.length ? List(host, usage.map((u) => ListRow(host, { key: `${u.type}-${u.id}-${u.how}`, lead: h('span', { className: 'mind-dot', style: { background: statusColour(u.status || 'publish') } }), label: u.title || u.id, sub: `${u.type} - ${u.how}`, onClick: () => onOpenItem(u.restBase || restBaseOf(u.type), u.id) }))) : h('p', { className: 'mlead', style: { margin: 0 } }, 'No featured image or content mentions it by name. Page-builder layouts are not searched.')),
    usage && !usage.length ? Panel(host, { title: 'Delete', action: meta('permanent, no trash for media') }, h('div', { style: { display: 'flex', gap: 6 } }, confirm ? [h(ui.Button, { key: 'y', disabled: !!busy, onClick: remove, style: { color: 'var(--sy-rosin)' } }, busy === 'delete' ? 'Deleting...' : 'Yes, delete it'), h(ui.Button, { key: 'n', className: 'sy-btn--sm', onClick: () => setConfirm(false) }, 'Keep it')] : h(ui.Button, { onClick: () => setConfirm(true) }, 'Delete the file'))) : null);
}
