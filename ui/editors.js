/**
 * The controls an item page is made of: an HTML editor with a rich view and a code view,
 * a media picker over the library, and a term picker over a taxonomy.
 */
import { bytes } from './helpers.js';

/** HTML edits as rich text (bold, italic, headings, lists, links) or as code in Monaco. */
export function HtmlEditor({ host, value, onChange, height = 320 }) {
  const { h, react, tokens, ui } = host;
  const { useRef, useEffect, useState } = react;
  const ref = useRef(null);
  const [code, setCode] = useState(() => /<!-- wp:/.test(value || '') || /\[[a-z_]+[^\]]*\]/.test(value || ''));
  useEffect(() => { if (!code && ref.current && ref.current.innerHTML !== (value || '')) ref.current.innerHTML = value || ''; }, [value, code]);
  const emit = () => onChange(ref.current ? ref.current.innerHTML : '');
  const cmd = (name, arg) => { ref.current && ref.current.focus(); document.execCommand(name, false, arg); emit(); };
  const tool = (label, fn, title) => h('button', { type: 'button', className: 'sy-btn sy-btn--sm', title, onMouseDown: (e) => e.preventDefault(), onClick: fn }, label);
  const blocks = /<!-- wp:/.test(value || '');
  return h('div', { style: { border: `1px solid ${tokens('line')}`, borderRadius: 6, background: 'var(--sy-surface)' } },
    h('div', { style: { display: 'flex', gap: 4, padding: 4, borderBottom: `1px solid ${tokens('line')}`, flexWrap: 'wrap', alignItems: 'center' } },
      !code ? [tool('B', () => cmd('bold'), 'Bold'), tool('I', () => cmd('italic'), 'Italic'), tool('H2', () => cmd('formatBlock', 'h2'), 'Heading 2'), tool('H3', () => cmd('formatBlock', 'h3'), 'Heading 3'), tool('P', () => cmd('formatBlock', 'p'), 'Paragraph'), tool('Quote', () => cmd('formatBlock', 'blockquote'), 'Quote'), tool('List', () => cmd('insertUnorderedList'), 'Bulleted list'), tool('1.', () => cmd('insertOrderedList'), 'Numbered list'), tool('Link', () => { const u = window.prompt('Link to'); if (u) cmd('createLink', u); }, 'Link'), tool('Clear', () => cmd('removeFormat'), 'Remove formatting')].map((t, i) => h('span', { key: i }, t)) : h('span', { className: 'mpanel__meta' }, blocks ? 'Block markup: edit it as HTML so the block comments stay intact.' : 'HTML'),
      h('span', { style: { flex: 1 } }),
      tool(code ? 'Rich text' : 'HTML', () => setCode(!code), code ? 'Back to rich text' : 'Edit the HTML')),
    code
      ? h(ui.CodeEditor, { value: value || '', language: 'html', height, onChange })
      : h('div', { ref, contentEditable: true, suppressContentEditableWarning: true, className: 'wp-prose', style: { minHeight: 140, maxHeight: height + 120, overflow: 'auto', padding: '8px 12px', outline: 'none', fontSize: 'var(--sy-fs-sm)', lineHeight: 1.55 }, onInput: emit, onBlur: emit }));
}

/** Pick a file from the media library. */
export function MediaPicker({ host, wp, kind = 'image', onPick, onClose }) {
  const { h, ui, react, tokens } = host;
  const { useState, useEffect } = react;
  const [q, setQ] = useState('');
  const [list, setList] = useState(null);
  useEffect(() => { setList(null); const t = setTimeout(() => wp(`/media?per_page=48${kind === 'image' ? '&media_type=image' : ''}&search=${encodeURIComponent(q)}&_fields=id,title,alt_text,source_url,mime_type,media_details`).then((d) => setList(d.items || [])).catch(() => setList([])), 250); return () => clearTimeout(t); }, [q, kind]);
  const thumb = (a) => (a.media_details && a.media_details.sizes && (a.media_details.sizes.medium || a.media_details.sizes.thumbnail) ? (a.media_details.sizes.medium || a.media_details.sizes.thumbnail).source_url : a.source_url);
  return h(ui.Modal, { title: kind === 'image' ? 'Pick an image' : 'Pick a file', onClose, footer: h(ui.Button, { onClick: onClose }, 'Cancel') },
    h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10, minWidth: 560 } },
      h(ui.Input, { value: q, placeholder: 'Search the library', onChange: (e) => setQ(e.target.value), autoFocus: true }),
      list === null ? h(ui.Skeleton, { count: 4, height: 18 }) : !list.length ? h('p', { className: 'mlead', style: { margin: 0 } }, 'Nothing matches.') : h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8, maxHeight: 420, overflow: 'auto', paddingRight: 14, scrollbarGutter: 'stable' } },
        list.map((a) => h('button', { key: a.id, type: 'button', title: (a.title && a.title.rendered) || a.id, onClick: () => onPick(a), style: { textAlign: 'left', padding: 0, border: `1px solid ${tokens('line')}`, borderRadius: 8, background: 'var(--sy-surface)', cursor: 'pointer', overflow: 'hidden', color: 'inherit', font: 'inherit' } },
          h('div', { style: { height: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', background: 'rgba(255,255,255,0.03)' } }, /^image\//.test(a.mime_type || '') ? h('img', { src: thumb(a), alt: '', loading: 'lazy', style: { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' } }) : h('span', { className: 'mpanel__meta' }, (a.mime_type || 'file').split('/').pop())),
          h('div', { style: { padding: '4px 6px', fontSize: 'var(--sy-fs-xs)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, (a.title && a.title.rendered) || a.id))))));
}

/** The terms of one taxonomy as chips, with a picker for more and an inline add. */
export function TermField({ host, wp, tax, selected, onChange, onCreated }) {
  const { h, ui, react, notify } = host;
  const { useState } = react;
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const sel = new Set(selected || []);
  const options = tax.options || [];
  const chosen = options.filter((o) => sel.has(o.id));
  const matches = q.trim() ? options.filter((o) => !sel.has(o.id) && o.name.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 8) : [];
  const add = async () => {
    const name = q.trim(); if (!name) return;
    setAdding(true);
    try { const r = await wp(`/terms/${encodeURIComponent(tax.restBase)}`, { method: 'POST', body: JSON.stringify({ name }) }); if (!r || !r.id) throw new Error((r && r.message) || 'Could not create the term'); onCreated({ id: r.id, name: r.name || name, slug: r.slug, parent: r.parent || 0, count: 0 }); onChange([...sel, r.id]); setQ(''); notify(`Added ${name}`, 'moss'); }
    catch (e) { notify(e.message, 'rosin'); } finally { setAdding(false); }
  };
  return h('div', { style: { position: 'relative' } },
    h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' } },
      chosen.map((o) => h(ui.Chip, { key: o.id, on: true, title: 'Remove', onClick: () => onChange([...sel].filter((x) => x !== o.id)) }, `${o.name} x`)),
      h(ui.Input, { value: q, placeholder: chosen.length ? 'add another' : `pick or type a ${tax.label.toLowerCase().replace(/s$/, '')}`, onChange: (e) => setQ(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter') { e.preventDefault(); if (matches.length) { onChange([...sel, matches[0].id]); setQ(''); } else add(); } if (e.key === 'Escape') setQ(''); }, style: { width: 220 } })),
    q.trim() ? h('div', { role: 'listbox', style: { position: 'absolute', left: 0, top: '100%', marginTop: 4, zIndex: 5, minWidth: 240, background: 'var(--sy-surface)', border: '1px solid var(--sy-line-strong)', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.35)', overflow: 'hidden' } },
      matches.map((o) => h('button', { key: o.id, type: 'button', onMouseDown: (e) => { e.preventDefault(); onChange([...sel, o.id]); setQ(''); }, style: { display: 'block', width: '100%', textAlign: 'left', padding: '7px 10px', border: 0, cursor: 'pointer', background: 'transparent', color: 'var(--sy-text)', font: 'inherit', fontSize: 'var(--sy-fs-sm)' } }, `${o.name}`, h('span', { className: 'mpanel__meta', style: { marginLeft: 8 } }, `${o.count}`))),
      !options.some((o) => o.name.toLowerCase() === q.trim().toLowerCase()) ? h('button', { type: 'button', disabled: adding, onMouseDown: (e) => { e.preventDefault(); add(); }, style: { display: 'block', width: '100%', textAlign: 'left', padding: '7px 10px', border: 0, borderTop: '1px solid var(--sy-line)', cursor: 'pointer', background: 'transparent', color: 'var(--sy-brass)', font: 'inherit', fontSize: 'var(--sy-fs-sm)' } }, adding ? 'Adding...' : `Create "${q.trim()}"`) : null) : null);
}

export const mediaLabel = (m) => `${m.width && m.height ? `${m.width}x${m.height} - ` : ''}${bytes(m.size) || ''}`;
