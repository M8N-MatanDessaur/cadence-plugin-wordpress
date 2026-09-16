/**
 * One item (a post, a page, anything with a post type) as a form: title, slug, content as
 * rich text or HTML, excerpt, featured image, taxonomies, author, parent and order, date to
 * schedule, status. Save writes it (a snapshot is taken first, always). Publish, schedule,
 * unpublish to draft, trash. The page on the site in an iframe. SEO fields. The AI reviews,
 * writes SEO, or writes a field from what you typed. Page-builder layouts (Elementor and the
 * like) are shown as a summary and edited where they live.
 */
import { ago, askModel, statusColour, statusLabel, builderLabel, stripHtml } from './helpers.js';
import { Panel, Stat, Health, List, ListRow, FILL } from './kit.js';
import { HtmlEditor, MediaPicker, TermField } from './editors.js';

export function useItem(host, wp, open) {
  const { react } = host;
  const { useState, useEffect, useCallback } = react;
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const reload = useCallback(() => {
    if (!open) return;
    setError(null);
    wp(`/item?type=${encodeURIComponent(open.type)}&id=${encodeURIComponent(open.id)}`).then((d) => { if (!d || d.error) throw new Error((d && d.error) || 'Item not found'); setData(d); }).catch((e) => setError(e.message));
  }, [wp, open && open.type, open && open.id]);
  useEffect(() => { setData(null); reload(); }, [reload]);
  return { data, error, reload };
}

const toLocal = (iso) => { if (!iso) return ''; const d = new Date(iso); if (isNaN(d)) return ''; const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
const slugify = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9\s-]/g, '').trim().replace(/[\s_-]+/g, '-').replace(/^-+|-+$/g, '');

export function ItemPage({ host, wp, site, current, open, item, typeRow, health, onChanged, onClose, onOpenItem, onDuplicate }) {
  const { h, ui, api, notify, tokens } = host;
  const { useState, useEffect } = host.react;
  const { data, error } = item;
  const [draft, setDraft] = useState({});
  const [busy, setBusy] = useState(null);
  const [ai, setAi] = useState(null);
  const [aiKind, setAiKind] = useState(null);
  const [confirmTrash, setConfirmTrash] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [zoom, setZoom] = useState(0.6);
  const [picker, setPicker] = useState(false);
  const [terms, setTerms] = useState({});
  const [schedule, setSchedule] = useState('');
  useEffect(() => { setDraft({}); setAi(null); setAiKind(null); setConfirmTrash(false); setShowPreview(false); setTerms({}); setSchedule(''); }, [open.id, data && data.modified]);
  const meta = (text) => h('span', { className: 'mpanel__meta' }, text);
  const empty = (text) => h('p', { className: 'mlead', style: { margin: 0 } }, text);
  if (error) return h(ui.EmptyState, { title: 'Could not open the item', body: error });
  if (!data) return h('div', null, h('div', { className: 'mstats mstats--head' }, [0, 1, 2, 3].map((k) => h('div', { key: k, className: 'mstat' }, h(ui.Skeleton, { count: 2, height: 14 })))), h('div', { className: 'wp-item', style: { marginTop: 'var(--sy-s3)' } }, Panel(host, { title: 'Fields' }, h(ui.Skeleton, { count: 8, height: 16 })), Panel(host, { title: 'Publish' }, h(ui.Skeleton, { count: 3, height: 16 }))));

  const rb = data.restBase;
  const val = (k, fallback) => (k in draft ? draft[k] : fallback);
  const title = val('title', data.title === '(no title)' ? '' : data.title);
  const slug = val('slug', data.slug || '');
  const content = val('content', data.content || '');
  const excerpt = val('excerpt', data.excerptRaw || '');
  const featured = val('featured_media', data.featuredMedia || 0);
  const parent = val('parent', data.parent || 0);
  const order = val('menu_order', data.menuOrder || 0);
  const date = val('date', data.date || '');
  const comments = val('comment_status', data.commentStatus || 'closed');
  const seo = { title: val('seoTitle', data.seo.title || ''), description: val('seoDescription', data.seo.description || ''), focus: val('seoFocus', data.seo.focusKeyword || '') };
  const dirty = Object.keys(draft).length > 0 || Object.keys(terms).length > 0;
  const changes = Object.keys(draft).length + Object.keys(terms).length;
  const set = (k, v) => setDraft({ ...draft, [k]: v });
  const published = data.status === 'publish';
  const isElementor = data.builder === 'elementor';
  const hasBuilder = data.builder && data.builder !== 'gutenberg' && data.builder !== 'classic';

  const body = (extra) => {
    const b = { ...(extra || {}) };
    if ('title' in draft) b.title = draft.title;
    if ('slug' in draft) b.slug = draft.slug;
    if ('content' in draft) b.content = draft.content;
    if ('excerpt' in draft) b.excerpt = draft.excerpt;
    if ('featured_media' in draft) b.featured_media = draft.featured_media;
    if ('parent' in draft) b.parent = draft.parent;
    if ('menu_order' in draft) b.menu_order = draft.menu_order;
    if ('date' in draft) b.date = draft.date;
    if ('comment_status' in draft) b.comment_status = draft.comment_status;
    for (const [restBase, ids] of Object.entries(terms)) b[restBase] = ids;
    const m = {};
    if ('seoTitle' in draft) { m._yoast_wpseo_title = draft.seoTitle; m.rank_math_title = draft.seoTitle; }
    if ('seoDescription' in draft) { m._yoast_wpseo_metadesc = draft.seoDescription; m.rank_math_description = draft.seoDescription; }
    if ('seoFocus' in draft) { m._yoast_wpseo_focuskw = draft.seoFocus; m.rank_math_focus_keyword = draft.seoFocus; }
    if (Object.keys(m).length) b.meta = Object.fromEntries(Object.entries(m).filter(([k]) => data.seo.plugin === 'rankmath' ? k.startsWith('rank_math') : k.startsWith('_yoast')));
    return b;
  };
  const act = async (fn, done) => { try { await fn(); if (done) notify(done, 'moss'); onChanged(); } catch (e) { notify(e.message, 'rosin'); } finally { setBusy(null); } };
  const write = (extra) => wp(`/content/${encodeURIComponent(rb)}/${data.id}`, { method: 'PUT', body: JSON.stringify(body(extra)) }).then((r) => { if (r && r.code) throw new Error(r.message || r.code); setDraft({}); setTerms({}); });
  const save = () => { setBusy('save'); act(() => write(), 'Saved (a snapshot was taken first)'); };
  const setStatus = (status, label) => { setBusy(status); act(() => write({ status }), label); };
  const scheduleIt = () => { if (!schedule) return; setBusy('future'); act(() => write({ status: 'future', date: new Date(schedule).toISOString().replace(/\.\d{3}Z$/, '') }), 'Scheduled'); };
  const trash = () => { setBusy('trash'); act(() => wp(`/content/${encodeURIComponent(rb)}/${data.id}`, { method: 'DELETE' }).then(() => onClose()), 'Moved to the trash'); };
  const duplicate = async () => { setBusy('duplicate'); try { const b = { title: `${title || data.title} (copy)`, status: 'draft', content: data.content || '', excerpt: data.excerptRaw || '', featured_media: data.featuredMedia || 0, parent: data.parent || 0, meta: {} }; for (const k of ['_elementor_data', '_elementor_edit_mode', '_elementor_version', '_elementor_template_type', '_yoast_wpseo_title', '_yoast_wpseo_metadesc']) if (data.meta[k] !== undefined) b.meta[k] = data.meta[k]; for (const [restBase, t] of Object.entries(data.terms || {})) b[restBase] = t.selected; const r = await wp(`/content/${encodeURIComponent(rb)}`, { method: 'POST', body: JSON.stringify(b) }); if (!r || !r.id) throw new Error((r && r.message) || 'WordPress did not return an id'); notify('Duplicated as a draft', 'moss'); onChanged(); onDuplicate(r.id); } catch (e) { notify(e.message, 'rosin'); } finally { setBusy(null); } };

  const summary = () => [`Title: ${title}`, `Slug: ${slug}`, `Status: ${statusLabel(data.status)}`, `Type: ${data.type}`, data.builder ? `Built with: ${builderLabel(data.builder)}` : '', `Excerpt: ${excerpt}`, `Meta title: ${seo.title}`, `Meta description: ${seo.description}`, `Focus keyword: ${seo.focus}`, isElementor && data.elementor ? `Layout text:\n${(data.elementor.summary.texts || []).map((t) => `- [${t.widget}] ${t.text}`).join('\n')}` : `Content:\n${stripHtml(content).slice(0, 6000)}`].filter(Boolean).join('\n');
  const askAi = async (kind, field) => {
    setAiKind(kind); setAi(null);
    try {
      const system = 'You help an editor working in WordPress. Plain, specific, no fluff, no emoji. Markdown unless asked for raw text. Write in the language of the content.';
      const prompt = kind === 'review'
        ? `Review this WordPress ${data.type} "${title}" (${statusLabel(data.status)}). Say what is missing, weak, inconsistent or risky (empty fields, placeholder text, SEO title and description length and keyword, slug, tone, a missing featured image, headings), then what to change, field by field. Short.\n\n${summary()}`
        : kind === 'seo'
          ? `Write SEO metadata for this WordPress ${data.type} "${title}": a meta title of 50 to 60 characters with the focus keyword near the start, a meta description of 140 to 160 characters with a call to action, and one focus keyword of 1 to 4 words. Reply as three lines: "Title: ...", "Description: ...", "Keyword: ...", nothing else.\n\n${summary()}`
          : `Write the ${field === 'excerpt' ? 'excerpt (two or three plain sentences)' : field === 'title' ? 'title (one line, no quotes)' : 'content as simple HTML (paragraphs, h2/h3 headings, lists; no inline styles, no scripts)'} of this WordPress ${data.type}. The editor wants to say, in their words: "${stripHtml(field === 'excerpt' ? excerpt : field === 'title' ? title : content).trim()}". Write that out properly in the site's voice - keep their intent, add only what makes it clear, never invent facts. Reply with the text only.\n\nFor context:\n${summary()}`;
      const text = await askModel(api, { prompt, system, maxTokens: kind === 'write' ? 1400 : 900, from: 'wordpress' });
      if (!text) { notify('Nothing came back', 'rosin'); setAiKind(null); return; }
      if (kind === 'write') { setDraft({ ...draft, [field]: text.replace(/^```[a-z]*\n?|\n?```$/g, '').trim() }); setAiKind(null); notify(`${field} written - review it, then Save`, 'moss'); }
      else if (kind === 'seo') { const t = (text.match(/Title:\s*(.+)/i) || [])[1]; const d = (text.match(/Description:\s*(.+)/i) || [])[1]; const k = (text.match(/Keyword:\s*(.+)/i) || [])[1]; setDraft({ ...draft, ...(t ? { seoTitle: t.trim() } : {}), ...(d ? { seoDescription: d.trim() } : {}), ...(k ? { seoFocus: k.trim() } : {}) }); setAiKind(null); setAi(text); notify('SEO fields written - review them, then Save', 'moss'); }
      else setAi(text);
    } catch (e) { notify(e.message, 'rosin'); setAiKind(null); }
  };

  const field = (label, sub, control, opts = {}) => h('div', { style: { padding: 'var(--sy-s2) 0', borderTop: `1px solid ${tokens('line')}` } },
    h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 } }, h('span', { style: { fontWeight: 600, fontSize: 'var(--sy-fs-sm)' } }, label), sub ? h('span', { className: 'mpanel__meta' }, sub) : null, opts.changed ? h('span', { className: 'mpanel__meta', style: { color: 'var(--sy-brass)' } }, 'changed') : null, h('span', { style: { flex: 1 } }), opts.ai ? h('button', { type: 'button', className: 'mpanel__meta', style: { background: 'none', border: 0, cursor: 'pointer', padding: 0 }, disabled: !!aiKind || !opts.aiReady, title: opts.aiReady ? 'The AI writes this field out from what is typed' : 'Type something first', onClick: () => askAi('write', opts.ai) }, aiKind === 'write' ? 'writing...' : 'write with AI') : null),
    control);
  const len = (s, max) => h('span', { className: 'mpanel__meta', style: { color: s.length > max ? 'var(--sy-rosin)' : undefined } }, `${s.length}/${max}`);

  const previewUrl = data.link && data.status === 'publish' ? data.link : data.link ? `${data.link}${data.link.includes('?') ? '&' : '?'}preview=true` : '';
  const previewPanel = showPreview && previewUrl ? Panel(host, { title: 'Preview', wide: true, style: { marginBottom: 'var(--sy-s3)' }, action: h('div', { style: { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' } },
    h('span', { className: 'mpanel__meta' }, previewUrl.replace(/^https?:\/\//, '')),
    h('span', { role: 'group', 'aria-label': 'Zoom', style: { display: 'inline-flex', alignItems: 'center', border: `1px solid ${tokens('line')}`, borderRadius: 6, overflow: 'hidden', height: 28 } },
      h('button', { type: 'button', title: 'Zoom out', onClick: () => setZoom(Math.max(0.3, Math.round((zoom - 0.1) * 10) / 10)), style: { width: 28, height: 28, border: 0, background: 'transparent', color: 'inherit', cursor: 'pointer', font: 'inherit', fontSize: 15, lineHeight: 1 } }, '−'),
      h('span', { className: 'mpanel__meta', style: { width: 44, textAlign: 'center', borderLeft: `1px solid ${tokens('line')}`, borderRight: `1px solid ${tokens('line')}`, lineHeight: '28px' } }, `${Math.round(zoom * 100)}%`),
      h('button', { type: 'button', title: 'Zoom in', onClick: () => setZoom(Math.min(1, Math.round((zoom + 0.1) * 10) / 10)), style: { width: 28, height: 28, border: 0, background: 'transparent', color: 'inherit', cursor: 'pointer', font: 'inherit', fontSize: 15, lineHeight: 1 } }, '+')),
    h('span', { style: { display: 'inline-flex', gap: 6 } },
      h('button', { type: 'button', className: 'sy-btn sy-btn--sm', style: { height: 28, display: 'inline-flex', alignItems: 'center', gap: 6 }, onClick: () => window.open(previewUrl, '_blank') }, h(host.icons.external, { size: 13 }), 'Open in a tab'),
      h('button', { type: 'button', className: 'sy-btn sy-btn--sm', style: { height: 28, display: 'inline-flex', alignItems: 'center', gap: 6 }, onClick: () => setShowPreview(false) }, h(host.icons.close, { size: 13 }), 'Hide'))) },
    h('div', { style: { position: 'relative', width: '100%', height: 560, overflow: 'hidden', borderRadius: 6, border: `1px solid ${tokens('line')}`, background: '#fff' } },
      h('iframe', { key: `${previewUrl}-${data.modified}`, src: `/api/plugins/wordpress/preview?url=${encodeURIComponent(previewUrl)}&site=${encodeURIComponent(site)}`, referrerPolicy: 'no-referrer', title: 'Preview', style: { position: 'absolute', top: 0, left: 0, width: `${100 / zoom}%`, height: `${100 / zoom}%`, border: 0, transform: `scale(${zoom})`, transformOrigin: '0 0' } }))) : null;

  const aiPanel = Panel(host, { title: 'AI', action: h('div', { style: { display: 'flex', gap: 6 } }, ai && host.writeNote ? h(ui.Button, { className: 'sy-btn--sm', onClick: async () => { if (await host.writeNote(`${data.type} ${title} review`, `# ${title}\n\n${ai}`)) notify('Saved and opened', 'moss'); } }, 'Save as note') : null, !ai ? meta(aiKind && aiKind !== 'write' ? 'reading...' : 'reads the item') : null) },
    ai ? h('div', { style: { maxHeight: 360, overflow: 'auto', paddingRight: 14, scrollbarGutter: 'stable' } }, h(ui.Markdown, { source: ai })) : h('p', { className: 'mlead', style: { margin: '0 0 var(--sy-s2)' } }, 'Review says what is missing or weak, field by field. SEO writes the meta title, description and focus keyword. Title, excerpt and content each have their own "write with AI" that expands what you typed.'),
    aiKind && aiKind !== 'write' && !ai ? h('div', { style: { marginTop: 'var(--sy-s2)' } }, h(ui.Skeleton, { count: 4, height: 14 })) : null,
    h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: ai ? 'var(--sy-s3)' : 0 } },
      h(ui.Button, { className: 'sy-btn--sm', disabled: !!aiKind && !ai, onClick: () => askAi('review') }, 'Review'),
      h(ui.Button, { className: 'sy-btn--sm', disabled: !!aiKind && !ai, onClick: () => askAi('seo') }, 'SEO')));

  const el = data.elementor;
  return h('div', { style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } },
    h('div', { style: { display: 'flex', alignItems: 'flex-start', gap: 'var(--sy-s3)', marginBottom: 'var(--sy-s3)' } },
      data.featured ? h('img', { src: data.featured.thumb || data.featured.url, alt: '', style: { width: 72, height: 72, objectFit: 'cover', borderRadius: 8, flex: 'none', background: 'rgba(255,255,255,0.03)' } }) : null,
      h('div', { style: { flex: 1, minWidth: 0 } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 } }, h('span', { className: 'mind-dot', style: { background: statusColour(data.status) } }), h('span', { className: 'mpanel__title' }, `${data.type} - ${statusLabel(data.status)}${data.builder ? ` - ${builderLabel(data.builder)}` : ''}`)),
        h('h2', { style: { margin: 0, fontSize: 22, lineHeight: 1.25, fontWeight: 600, color: 'var(--sy-text)' } }, title || data.title),
        h('p', { className: 'mlead', style: { margin: '6px 0 0' } }, `${data.link ? `${data.link.replace(/^https?:\/\/[^/]+/, '') || '/'} - ` : ''}${data.words ? `${data.words} words - ` : ''}${data.authorName ? `by ${data.authorName} - ` : ''}${data.modified ? `updated ${ago(data.modified)}` : ''}${data.date ? ` - ${published ? 'published' : 'dated'} ${new Date(data.date).toLocaleDateString()}` : ''}.`)),
      h('div', { style: { display: 'flex', gap: 6, flex: 'none', flexWrap: 'wrap', justifyContent: 'flex-end' } },
        previewUrl ? h(ui.Button, { className: 'sy-btn--sm', onClick: () => setShowPreview(!showPreview) }, showPreview ? 'Hide preview' : 'Preview here') : null,
        h(ui.Button, { className: 'sy-btn--sm', disabled: !!busy, onClick: duplicate }, busy === 'duplicate' ? 'Duplicating...' : 'Duplicate'),
        h('a', { className: 'sy-btn sy-btn--sm', href: data.editUrl, target: '_blank', rel: 'noreferrer' }, hasBuilder ? `Edit in ${builderLabel(data.builder)}` : 'In wp-admin'))),
    previewPanel,
    h('div', { className: 'mstats mstats--head' },
      Stat(host, { label: 'State', value: statusLabel(data.status), tone: published ? 'moss' : data.status === 'future' || data.status === 'pending' ? 'brass' : 'rosin', hint: published ? 'live on the site' : data.status === 'future' ? `goes live ${new Date(data.date).toLocaleString()}` : 'not live' }),
      Stat(host, { label: 'Meta description', value: seo.description ? `${seo.description.length}` : 'none', tone: !seo.description ? 'rosin' : seo.description.length > 160 ? 'brass' : 'moss', hint: 'characters, 140 to 160 is right' }),
      Stat(host, { label: 'Unsaved', value: changes, tone: dirty ? 'brass' : 'muted', hint: dirty ? 'Save writes them' : undefined }),
      Stat(host, { label: 'Snapshots', value: (data.backups || []).length, tone: 'muted', hint: (data.backups || []).length ? `last ${ago(data.backups[0].timestamp)}` : 'none yet' })),
    h('div', { className: 'wp-row2', style: showPreview ? { flex: 'none' } : { flex: 1, minHeight: 360 } },
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)', minWidth: 0, minHeight: 0 } },
        Panel(host, { title: 'Fields', ...FILL, action: h('div', { style: { display: 'flex', gap: 6, alignItems: 'center' } }, dirty ? h(ui.Button, { className: 'sy-btn--sm', onClick: () => { setDraft({}); setTerms({}); } }, 'Discard') : null, h(ui.Button, { className: 'sy-btn--sm', variant: 'primary', disabled: !dirty || !!busy, onClick: save }, busy === 'save' ? 'Saving...' : dirty ? `Save ${changes}` : 'Saved')) },
          field('Title', 'title', h(ui.Input, { value: title, onChange: (e) => set('title', e.target.value) }), { changed: 'title' in draft, ai: 'title', aiReady: !!title.trim() }),
          field('Slug', 'the URL', h('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } }, h('span', { className: 'mpanel__meta' }, '/'), h(ui.Input, { value: slug, onChange: (e) => set('slug', e.target.value), style: { flex: 1 } }), h(ui.Button, { className: 'sy-btn--sm', onClick: () => set('slug', slugify(title)) }, 'From the title')), { changed: 'slug' in draft }),
          hasBuilder
            ? field('Layout', builderLabel(data.builder), h('div', null,
              el ? h('p', { className: 'mlead', style: { margin: '0 0 8px' } }, `${el.summary.sections + el.summary.containers} section${el.summary.sections + el.summary.containers === 1 ? '' : 's'}, ${el.summary.widgets} widget${el.summary.widgets === 1 ? '' : 's'}${el.summary.images ? `, ${el.summary.images} image${el.summary.images === 1 ? '' : 's'}` : ''}${el.version ? ` - Elementor ${el.version}` : ''}. The layout is edited in ${builderLabel(data.builder)}; the text it holds is listed on the right.`) : h('p', { className: 'mlead', style: { margin: '0 0 8px' } }, `The layout is edited in ${builderLabel(data.builder)}.`),
              el ? h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6 } }, Object.entries(el.summary.byWidget).sort((a, b) => b[1] - a[1]).map(([w, n]) => h(ui.Chip, { key: w }, `${w} ${n}`))) : null))
            : field('Content', 'HTML', h(HtmlEditor, { host, value: content, onChange: (v) => set('content', v), height: 320 }), { changed: 'content' in draft, ai: 'content', aiReady: !!stripHtml(content).trim() }),
          field('Excerpt', 'summary', h(ui.Textarea, { value: excerpt, rows: 3, onChange: (e) => set('excerpt', e.target.value) }), { changed: 'excerpt' in draft, ai: 'excerpt', aiReady: !!excerpt.trim() }),
          field('Featured image', 'featured_media', h('div', { style: { display: 'flex', gap: 12, alignItems: 'flex-start' } },
            featured && data.featured && featured === data.featuredMedia ? h('img', { src: data.featured.thumb || data.featured.url, alt: '', style: { maxWidth: 200, maxHeight: 120, borderRadius: 6, background: 'rgba(255,255,255,0.03)' } }) : featured ? h('span', { className: 'mpanel__meta' }, `media #${featured}`) : h('span', { className: 'mlead', style: { margin: 0 } }, 'None.'),
            h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } }, h(ui.Button, { className: 'sy-btn--sm', onClick: () => setPicker(true) }, featured ? 'Change' : 'Pick an image'), featured ? h(ui.Button, { className: 'sy-btn--sm', onClick: () => set('featured_media', 0) }, 'Remove') : null)), { changed: 'featured_media' in draft }),
          ...Object.entries(data.terms || {}).map(([restBase, tax]) => field(tax.label, tax.slug, h(TermField, { host, wp, tax: { ...tax, restBase }, selected: restBase in terms ? terms[restBase] : tax.selected, onChange: (ids) => setTerms({ ...terms, [restBase]: ids }), onCreated: (t) => { tax.options.push(t); } }), { changed: restBase in terms })),
          typeRow && typeRow.hierarchical ? field('Parent and order', 'parent, menu_order', h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } }, h(ui.Input, { type: 'number', value: parent, onChange: (e) => set('parent', Number(e.target.value) || 0), style: { width: 120 }, title: 'Parent id, 0 for none' }), h(ui.Input, { type: 'number', value: order, onChange: (e) => set('menu_order', Number(e.target.value) || 0), style: { width: 120 }, title: 'Order' })), { changed: 'parent' in draft || 'menu_order' in draft }) : null,
          field('Date', 'date', h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } }, h(ui.Input, { type: 'datetime-local', value: toLocal(date), onChange: (e) => set('date', e.target.value ? new Date(e.target.value).toISOString().replace(/\.\d{3}Z$/, '') : ''), style: { width: 230 } }), h(ui.Chip, { on: comments === 'open', onClick: () => set('comment_status', comments === 'open' ? 'closed' : 'open') }, comments === 'open' ? 'comments open' : 'comments closed')), { changed: 'date' in draft || 'comment_status' in draft }),
          field('SEO', data.seo.plugin === 'rankmath' ? 'Rank Math' : data.seo.plugin === 'yoast' ? 'Yoast' : 'meta', h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
            h('div', null, h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 } }, h('span', { className: 'mpanel__meta' }, 'Meta title'), len(seo.title, 60)), h(ui.Input, { value: seo.title, placeholder: data.seoTitleStored || 'from the site template', onChange: (e) => set('seoTitle', e.target.value) })),
            h('div', null, h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 } }, h('span', { className: 'mpanel__meta' }, 'Meta description'), len(seo.description, 160)), h(ui.Textarea, { value: seo.description, rows: 3, onChange: (e) => set('seoDescription', e.target.value) })),
            h('div', null, h('div', { className: 'mpanel__meta', style: { marginBottom: 4 } }, 'Focus keyword'), h(ui.Input, { value: seo.focus, onChange: (e) => set('seoFocus', e.target.value), style: { maxWidth: 320 } })),
            data.noindex ? h('p', { className: 'mlead', style: { margin: 0, color: 'var(--sy-brass)' } }, 'Search engines are told not to index this page.') : null), { changed: 'seoTitle' in draft || 'seoDescription' in draft || 'seoFocus' in draft }),
          picker ? h(MediaPicker, { host, wp, kind: 'image', onClose: () => setPicker(false), onPick: (m) => { set('featured_media', m.id); setPicker(false); } }) : null)),
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)', minWidth: 0, minHeight: 0, overflow: 'auto', paddingRight: 8, scrollbarGutter: 'stable' } },
        Panel(host, { title: 'Publish', action: meta(published ? 'live' : data.status === 'future' ? 'scheduled' : 'not live') },
          h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
            !published ? h(ui.Button, { variant: 'primary', disabled: !!busy, onClick: () => setStatus('publish', 'Published') }, busy === 'publish' ? 'Publishing...' : dirty ? 'Save and publish' : 'Publish') : dirty ? h(ui.Button, { variant: 'primary', disabled: !!busy, onClick: save }, busy === 'save' ? 'Saving...' : 'Save the changes live') : null,
            published ? h(ui.Button, { disabled: !!busy, onClick: () => setStatus('draft', 'Back to a draft') }, busy === 'draft' ? 'Unpublishing...' : 'Unpublish') : null,
            data.status !== 'pending' && !published ? h(ui.Button, { disabled: !!busy, onClick: () => setStatus('pending', 'Sent for review') }, busy === 'pending' ? '...' : 'For review') : null,
            data.status !== 'private' ? h(ui.Button, { disabled: !!busy, onClick: () => setStatus('private', 'Now private') }, busy === 'private' ? '...' : 'Private') : null,
            confirmTrash ? h(ui.Button, { disabled: !!busy, onClick: trash, style: { color: 'var(--sy-rosin)' } }, busy === 'trash' ? 'Trashing...' : 'Yes, trash it') : h(ui.Button, { disabled: !!busy, onClick: () => setConfirmTrash(true) }, 'Trash'),
            confirmTrash ? h(ui.Button, { className: 'sy-btn--sm', onClick: () => setConfirmTrash(false) }, 'Keep it') : null),
          h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', marginTop: 'var(--sy-s2)', flexWrap: 'wrap' } }, h('span', { className: 'mpanel__meta' }, 'Schedule for'), h(ui.Input, { type: 'datetime-local', value: schedule, onChange: (e) => setSchedule(e.target.value), style: { width: 230 } }), h(ui.Button, { className: 'sy-btn--sm', disabled: !schedule || !!busy, onClick: scheduleIt }, busy === 'future' ? 'Scheduling...' : 'Schedule')),
          published && dirty ? h('p', { className: 'mlead', style: { margin: 'var(--sy-s2) 0 0', color: 'var(--sy-brass)' } }, 'This item is live: saving changes it on the site at once. A snapshot is taken first.') : null),
        aiPanel,
        el && el.summary.texts.length ? Panel(host, { title: 'Text in the layout', style: { flex: '1 0 auto', minHeight: 160, display: 'flex', flexDirection: 'column' }, bodyStyle: { flex: 1, minHeight: 0, overflow: 'auto', paddingRight: 14, scrollbarGutter: 'stable' }, action: meta(`${el.summary.texts.length} widget${el.summary.texts.length === 1 ? '' : 's'} with text`) }, List(host, el.summary.texts.map((t) => ListRow(host, { key: t.id, lead: h('span', { className: 'mind-dot', style: { background: 'var(--sy-text-3)', width: 7, height: 7 } }), label: t.text, sub: t.widget })))) : null,
        Panel(host, { title: 'Snapshots', bodyStyle: { maxHeight: 180, overflow: 'auto', paddingRight: 14, scrollbarGutter: 'stable' }, action: meta((data.backups || []).length ? `${data.backups.length}` : 'none') },
          (data.backups || []).length ? List(host, data.backups.map((b) => ListRow(host, { key: b.backupId, lead: h('span', { className: 'mind-dot', style: { background: b.reason === 'manual' ? 'var(--sy-brass)' : 'var(--sy-text-3)', width: 7, height: 7 } }), label: `${b.reason} - ${statusLabel(b.status)}`, sub: new Date(b.timestamp).toLocaleString(), meta: h('button', { type: 'button', className: 'sy-btn sy-btn--sm', disabled: !!busy, onClick: () => { setBusy('restore'); act(() => wp(`/restore/${encodeURIComponent(b.backupId)}`, { method: 'POST', body: '{}' }).then((r) => { if (!r || !r.ok) throw new Error((r && r.error) || 'Restore failed'); }), 'Restored (the state before was snapshotted too)'); } }, 'Restore') }))) : empty('Every save, trash and restore snapshots the item first; they appear here.')))));
}

export function ItemAside({ host, wp, site, current, open, item, health, onOpenItem, onChanged }) {
  const { h, ui, notify } = host;
  const { useState } = host.react;
  const { data } = item;
  const [busy, setBusy] = useState(false);
  const meta = (text) => h('span', { className: 'mpanel__meta' }, text);
  const snapshot = async () => { if (!data) return; setBusy(true); try { await wp('/backup', { method: 'POST', body: JSON.stringify({ restBase: data.restBase, id: data.id, reason: 'manual' }) }); notify('Snapshot taken', 'moss'); onChanged(); } catch (e) { notify(e.message, 'rosin'); } finally { setBusy(false); } };
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)', flex: 1, minHeight: 0, height: '100%' } },
    data ? Panel(host, { title: 'Details' }, h(ui.InfoGrid, { items: [{ label: 'Id', value: data.id }, { label: 'Type', value: data.type }, { label: 'Author', value: data.authorName || data.author || '-' }, { label: 'Updated', value: data.modified ? new Date(data.modified).toLocaleString() : '-' }, { label: 'Date', value: data.date ? new Date(data.date).toLocaleString() : '-' }, { label: 'Template', value: data.template || 'default' }, { label: 'Built with', value: builderLabel(data.builder) }] })) : h(ui.Skeleton, { count: 5, height: 14 }),
    data && data.seo && data.seo.rendered ? Panel(host, { title: 'As Google sees it', action: meta(data.seo.plugin || '') }, h('div', { style: { fontSize: 'var(--sy-fs-sm)' } }, h('div', { style: { color: 'var(--sy-brass)', fontWeight: 600, marginBottom: 2 } }, data.seo.rendered.title || '(no title)'), h('div', { className: 'mpanel__meta', style: { marginBottom: 4, wordBreak: 'break-all' } }, data.link), h('div', { style: { color: 'var(--sy-text-2)' } }, data.seo.rendered.description || '(no description)'), data.seo.rendered.robots && data.seo.rendered.robots.index === 'noindex' ? h('div', { className: 'mpanel__meta', style: { color: 'var(--sy-rosin)', marginTop: 4 } }, 'noindex') : null)) : null,
    Panel(host, { title: 'Safety', action: meta('snapshots live on this machine') }, h('p', { className: 'mlead', style: { margin: '0 0 var(--sy-s2)' } }, 'Every write takes a snapshot first. Take one by hand before a big rewrite.'), h(ui.Button, { className: 'sy-btn--sm', disabled: busy || !data, onClick: snapshot }, busy ? 'Taking...' : 'Snapshot now')),
    data ? Panel(host, { title: 'Open' }, h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6 } }, data.link ? h('a', { className: 'sy-btn sy-btn--sm', href: data.link, target: '_blank', rel: 'noreferrer' }, 'On the site') : null, h('a', { className: 'sy-btn sy-btn--sm', href: data.editUrl, target: '_blank', rel: 'noreferrer' }, 'In wp-admin'), data.elementor ? h('a', { className: 'sy-btn sy-btn--sm', href: data.elementor.editUrl, target: '_blank', rel: 'noreferrer' }, 'In Elementor') : null)) : null);
}

export function NewItem({ host, wp, type, typeRow, health, onCreated, onCancel }) {
  const { h, ui, notify } = host;
  const { useState } = host.react;
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [content, setContent] = useState('');
  const [excerpt, setExcerpt] = useState('');
  const [busy, setBusy] = useState(false);
  const create = async () => {
    if (!title.trim()) return notify('Give it a title', 'rosin');
    setBusy(true);
    try { const r = await wp(`/content/${encodeURIComponent(type)}`, { method: 'POST', body: JSON.stringify({ title: title.trim(), slug: slug.trim() || undefined, content, excerpt, status: 'draft' }) }); if (!r || !r.id) throw new Error((r && r.message) || 'WordPress did not return an id'); notify('Created as a draft', 'moss'); onCreated(r.id); }
    catch (e) { notify(e.message, 'rosin'); } finally { setBusy(false); }
  };
  return Panel(host, { title: `New ${typeRow ? typeRow.label.replace(/s$/, '') : type}`, wide: true, action: h('span', { className: 'mpanel__meta' }, 'created as a draft; publish it from the item') },
    h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
      h(ui.Field, { label: 'Title' }, h(ui.Input, { value: title, onChange: (e) => setTitle(e.target.value), autoFocus: true })),
      h(ui.Field, { label: 'Slug', hint: 'blank lets WordPress derive it from the title' }, h(ui.Input, { value: slug, placeholder: slugify(title), onChange: (e) => setSlug(e.target.value) })),
      h(ui.Field, { label: 'Content' }, h(HtmlEditor, { host, value: content, onChange: setContent, height: 260 })),
      h(ui.Field, { label: 'Excerpt' }, h(ui.Textarea, { value: excerpt, rows: 3, onChange: (e) => setExcerpt(e.target.value) })),
      h('div', { style: { display: 'flex', gap: 8 } }, h(ui.Button, { onClick: onCancel }, 'Cancel'), h('span', { style: { flex: 1 } }), h(ui.Button, { variant: 'primary', disabled: busy, onClick: create }, busy ? 'Creating...' : 'Create the draft'))));
}
