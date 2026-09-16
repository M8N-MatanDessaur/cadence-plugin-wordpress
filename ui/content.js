/**
 * Content: the post types the site has (core, custom, and the internal ones apart), a type's
 * items with status filters and paging, and the tools of a type in the right pane.
 */
import { ago, statusColour, statusLabel, builderLabel } from './helpers.js';
import { Panel, Stat, Health, List, ListRow, FILL } from './kit.js';
import { typeRow, itemRow } from './overview.js';

export function Types({ host, health, q, onOpen }) {
  const { h, ui } = host;
  const { data } = health;
  const meta = (text) => h('span', { className: 'mpanel__meta' }, text);
  const empty = (text) => h('p', { className: 'mlead', style: { margin: 0 } }, text);
  const all = (data ? data.types || [] : []).filter((t) => t.slug !== 'attachment').filter((t) => !q || t.label.toLowerCase().includes(q) || t.slug.includes(q));
  const core = all.filter((t) => !t.internal && (t.slug === 'post' || t.slug === 'page'));
  const custom = all.filter((t) => !t.internal && t.slug !== 'post' && t.slug !== 'page');
  const internal = all.filter((t) => t.internal);
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)' } },
    h('div', { className: 'mstats mstats--head' },
      Stat(host, { label: 'Types', value: !data ? '...' : core.length + custom.length, tone: 'brass', hint: data ? `${internal.length} internal` : undefined }),
      Stat(host, { label: 'Items', value: !data ? '...' : [...core, ...custom].reduce((n, t) => n + t.total, 0), tone: 'muted' }),
      Stat(host, { label: 'Drafts', value: !data ? '...' : [...core, ...custom].reduce((n, t) => n + t.drafts, 0), tone: data && [...core, ...custom].some((t) => t.drafts) ? 'brass' : 'muted' }),
      Stat(host, { label: 'Pending or scheduled', value: !data ? '...' : [...core, ...custom].reduce((n, t) => n + t.pending + t.scheduled, 0), tone: 'muted' })),
    core.length ? Panel(host, { title: 'Posts and pages', wide: true, action: meta(`${core.length}`) }, List(host, core.map((t) => typeRow(host, t, onOpen)))) : null,
    custom.length ? Panel(host, { title: 'Custom types', wide: true, action: meta('from plugins and the theme') }, List(host, custom.sort((a, b) => b.total - a.total).map((t) => typeRow(host, t, onOpen)))) : null,
    internal.length ? Panel(host, { title: 'Internal', wide: true, action: meta('menus, templates, fonts, blocks') }, List(host, internal.map((t) => typeRow(host, t, onOpen)))) : null,
    !data ? Panel(host, { title: 'Types', wide: true }, h(ui.Skeleton, { count: 6, height: 18 })) : !all.length ? Panel(host, { title: 'Types', wide: true }, empty('No type matches.')) : null);
}

const STATUSES = [['any', 'All'], ['publish', 'Published'], ['draft', 'Drafts'], ['pending', 'Pending'], ['future', 'Scheduled'], ['private', 'Private'], ['trash', 'Trash']];

export function Items({ host, wp, site, type, typeRow: t, q, onOpen }) {
  const { h, ui } = host;
  const { useState, useEffect } = host.react;
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('any');
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [type, q, status]);
  useEffect(() => { setData(null); wp(`/entries?type=${encodeURIComponent(type)}&q=${encodeURIComponent(q || '')}&status=${status}&per_page=50&page=${page}`).then((d) => { if (d && d.error) throw new Error(d.error); setData(d); }).catch((e) => setData({ error: e.message, entries: [] })); }, [type, q, status, page, site]);
  const meta = (text) => h('span', { className: 'mpanel__meta' }, text);
  const empty = (text) => h('p', { className: 'mlead', style: { margin: 0 } }, text);
  const list = data ? data.entries || [] : [];
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)' } },
    h('div', { className: 'mstats mstats--head' },
      Stat(host, { label: 'Items', value: t ? t.total : '...', tone: 'brass' }),
      Stat(host, { label: 'Published', value: t ? t.published : '...', tone: 'moss' }),
      Stat(host, { label: 'Drafts', value: t ? t.drafts : '...', tone: t && t.drafts ? 'brass' : 'muted' }),
      Stat(host, { label: 'Pending or scheduled', value: t ? t.pending + t.scheduled : '...', tone: t && (t.pending + t.scheduled) ? 'brass' : 'muted', hint: t ? `${t.pending} pending, ${t.scheduled} scheduled` : undefined })),
    Panel(host, { title: t ? t.label : type, wide: true, action: h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' } },
      STATUSES.map(([k, l]) => h(ui.Chip, { key: k, on: status === k, onClick: () => setStatus(k) }, l)),
      data && data.total > 50 ? h('span', { className: 'mpanel__meta', style: { marginLeft: 8 } }, `${(page - 1) * 50 + 1}-${Math.min(page * 50, data.total)} of ${data.total}`) : null,
      data && page > 1 ? h(ui.Button, { className: 'sy-btn--sm', onClick: () => setPage(page - 1) }, 'Newer') : null,
      data && page < data.totalPages ? h(ui.Button, { className: 'sy-btn--sm', onClick: () => setPage(page + 1) }, 'Older') : null) },
      !data ? h(ui.Skeleton, { count: 8, height: 18 }) : data.error ? empty(data.error) : list.length ? List(host, list.map((e) => ListRow(host, { key: e.id, lead: h('span', { className: 'mind-dot', style: { background: statusColour(e.status) } }), label: e.title, sub: `${statusLabel(e.status)}${e.builder ? ` - ${builderLabel(e.builder)}` : ''}${e.words ? ` - ${e.words} words` : ''}${e.slug ? ` - /${e.slug}` : ''}${e.seoDescription ? '' : e.status === 'publish' ? ' - no meta description' : ''}`, meta: e.modified ? ago(e.modified) : '', onClick: () => onOpen(e.id) }))) : empty(q ? 'Nothing matches.' : status !== 'any' ? 'Nothing of that kind.' : 'No item of this type yet.')));
}

export function ContentAside({ host, health, openType, onOpenType, onOpenItem }) {
  const { h, ui } = host;
  const { data } = health;
  const meta = (text) => h('span', { className: 'mpanel__meta' }, text);
  const types = (data ? data.types || [] : []).filter((t) => t.slug !== 'attachment');
  const t = openType ? types.find((x) => x.restBase === openType) : null;
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)', flex: 1, minHeight: 0, height: '100%' } },
    t ? Panel(host, { title: 'This type', action: meta(t.slug) }, h(ui.InfoGrid, { items: [{ label: 'Items', value: t.total }, { label: 'Published', value: t.published }, { label: 'Drafts', value: t.drafts }, { label: 'Pending', value: t.pending }, { label: 'Scheduled', value: t.scheduled }, { label: 'Taxonomies', value: (t.taxonomies || []).join(', ') || 'none' }] })) : null,
    Panel(host, { title: 'Types', ...FILL, action: meta(data ? `${types.length}` : '...') },
      !data ? h(ui.Skeleton, { count: 6, height: 16 }) : List(host, types.filter((x) => !x.internal).map((x) => ListRow(host, { key: x.restBase, lead: h('span', { className: 'mind-dot', style: { background: x.restBase === openType ? 'var(--sy-brass)' : 'var(--sy-text-3)' } }), label: x.label, sub: `${x.slug} - ${x.total}`, onClick: () => onOpenType(x.restBase) })))),
    !openType && data && (data.recent || []).length ? Panel(host, { title: 'Changed last', ...FILL, action: meta(`${data.recent.length}`) }, List(host, data.recent.slice(0, 8).map((e) => itemRow(host, e, onOpenItem)))) : null);
}

/** The tools of a type, in the right pane. */
export function TypeTools({ host, wp, type, typeRow, health, mode, setMode }) {
  const { h, ui } = host;
  const meta = (text) => h('span', { className: 'mpanel__meta' }, text);
  const taxes = typeRow && health.data ? (health.data.taxonomies || []).filter((x) => (typeRow.taxonomies || []).includes(x.slug)) : [];
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)' } },
    Panel(host, { title: 'Do', action: meta(mode ? 'one open' : '') },
      h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6 } }, h(ui.Button, { className: 'sy-btn--sm', variant: 'primary', onClick: () => setMode(mode === 'new' ? null : 'new') }, 'New'), health.data ? h('a', { className: 'sy-btn sy-btn--sm', href: `${health.data.adminUrl}edit.php?post_type=${encodeURIComponent(typeRow ? typeRow.slug : type)}`, target: '_blank', rel: 'noreferrer' }, 'In wp-admin') : null)),
    typeRow ? Panel(host, { title: 'This type', action: meta(typeRow.slug) }, h(ui.InfoGrid, { items: [{ label: 'Items', value: typeRow.total }, { label: 'Published', value: typeRow.published }, { label: 'Drafts', value: typeRow.drafts }, { label: 'Pending', value: typeRow.pending }, { label: 'Scheduled', value: typeRow.scheduled }, { label: 'Hierarchical', value: typeRow.hierarchical ? 'yes' : 'no' }] })) : null,
    Panel(host, { title: 'Taxonomies', action: meta(`${taxes.length}`) }, taxes.length ? List(host, taxes.map((x) => ListRow(host, { key: x.slug, label: x.label, sub: `${x.slug} - ${x.count} term${x.count === 1 ? '' : 's'}` }))) : h('p', { className: 'mlead', style: { margin: 0 } }, 'None on this type.')));
}
