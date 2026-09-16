/**
 * The site as a bento: what it holds, what needs attention, what changed last, whether it answers.
 */
import { ago, statusColour, statusLabel, builderLabel } from './helpers.js';
import { Panel, Stat, Health, Bars, List, ListRow, FILL } from './kit.js';

export function useHealth(host, wp, site, enabled) {
  const { react } = host;
  const { useState, useEffect, useCallback } = react;
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const reload = useCallback((fresh) => {
    if (!site || !enabled) return;
    setError(null);
    wp(`/health${fresh ? '?refresh=1' : ''}`).then((d) => { if (d && d.error) throw new Error(d.error); setData(d); }).catch((e) => { setData(null); setError(e.message); });
  }, [wp, site, enabled]);
  useEffect(() => { setData(null); reload(); }, [site, enabled]);
  return { data, error, reload };
}

export const typeRow = (host, t, onOpen) => ListRow(host, { key: t.restBase, lead: host.h('span', { className: 'mind-dot', style: { background: t.slug === 'page' || t.slug === 'post' ? 'var(--sy-brass)' : t.internal ? 'var(--sy-text-3)' : 'var(--sy-moss)' } }), label: `${t.label} (${t.slug})`, sub: t.internal ? 'internal' : `${t.published} published${t.drafts ? `, ${t.drafts} draft${t.drafts === 1 ? '' : 's'}` : ''}${t.pending ? `, ${t.pending} pending` : ''}${t.scheduled ? `, ${t.scheduled} scheduled` : ''}${t.private ? `, ${t.private} private` : ''}${t.lastModified ? ` - changed ${ago(t.lastModified)}` : ''}`, meta: `${t.total}`, onClick: () => onOpen(t.restBase) });
export const itemRow = (host, e, onOpen, extra) => ListRow(host, { key: `${e.type}-${e.id}`, lead: host.h('span', { className: 'mind-dot', style: { background: statusColour(e.status) } }), label: e.title, sub: `${e.type} - ${statusLabel(e.status)}${e.builder ? ` - ${builderLabel(e.builder)}` : ''}${e.slug ? ` - /${e.slug}` : ''}${extra ? ` - ${extra}` : ''}`, meta: e.modified ? ago(e.modified) : '', onClick: () => onOpen(e.restBase || restBaseOf(e.type), e.id) });
export const restBaseOf = (type) => (type === 'post' ? 'posts' : type === 'page' ? 'pages' : type === 'attachment' ? 'media' : type);

export function Overview({ host, health, insights, q, current, onOpenItem, onOpenType, onAction }) {
  const { h, ui } = host;
  const { data, error } = health;
  const meta = (text) => h('span', { className: 'mpanel__meta' }, text);
  const empty = (text) => h('p', { className: 'mlead', style: { margin: 0 } }, text);
  if (error) return h(ui.EmptyState, { title: 'WordPress did not answer', body: error });
  const loading = !data;
  const types = (data ? data.types || [] : []).filter((t) => !t.internal && t.slug !== 'attachment').filter((t) => !q || t.label.toLowerCase().includes(q) || t.slug.includes(q));
  const issues = data ? data.issues || [] : [];
  const c = insights.data ? insights.data.counts : null;
  const toLook = c ? c.pending + c.missingSeoTitle + c.missingSeoDescription + c.longSeoTitle + c.longSeoDescription + c.noindex + c.noFeaturedImage + c.thin + c.untitled : 0;
  const items = types.reduce((n, t) => n + t.total, 0);
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)' } },
    h('div', { className: 'mstats mstats--head' },
      Stat(host, { label: 'Content', value: loading ? '...' : items, tone: 'brass', hint: loading ? undefined : `in ${types.length} type${types.length === 1 ? '' : 's'}` }),
      Stat(host, { label: 'Not live', value: loading ? '...' : data.counts.drafts + data.counts.pending + data.counts.scheduled, tone: data && (data.counts.drafts + data.counts.pending) ? 'brass' : 'muted', hint: loading ? undefined : `${data.counts.drafts} drafts, ${data.counts.pending} pending, ${data.counts.scheduled} scheduled` }),
      Stat(host, { label: 'To look at', value: !c ? '...' : toLook, tone: toLook ? 'rosin' : 'muted', hint: c ? `${c.missingSeoDescription} without meta description` : 'reading the content...' }),
      Stat(host, { label: 'Comments waiting', value: loading ? '...' : data.counts.pendingComments, tone: data && data.counts.pendingComments ? 'brass' : 'muted', hint: 'awaiting moderation' })),
    h('div', { className: 'mhealth' },
      Health(host, { label: 'site', value: loading ? '...' : data.site.name || data.siteUrl }),
      Health(host, { label: 'as', value: loading ? '...' : data.user ? `${data.user.name} (${(data.user.roles || []).join(', ')})` : 'not signed in' }),
      Health(host, { label: 'media', value: loading ? '...' : data.counts.media }),
      Health(host, { label: 'images without alt', value: loading ? '...' : c ? c.imagesNoAlt : data.counts.imagesNoAlt === null ? 'reading...' : data.counts.imagesNoAlt }),
      Health(host, { label: 'plugins seen', value: loading ? '...' : (data.plugins || []).map((p) => p.label).join(', ') || 'none' }),
      Health(host, { label: 'bridge', value: loading ? '...' : data.bridge ? 'installed' : 'missing' })),
    onAction ? Panel(host, { title: 'Do', wide: true, action: meta('everything WordPress, from here') },
      h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6 } },
        h(ui.Button, { className: 'sy-btn--sm', variant: 'primary', onClick: () => onOpenType((types.find((t) => t.slug === 'page') || types[0] || {}).restBase || 'pages') }, 'Open a type to write or edit'),
        h(ui.Button, { className: 'sy-btn--sm', onClick: () => onAction('insights') }, 'Fix SEO and stale content'),
        h(ui.Button, { className: 'sy-btn--sm', onClick: () => onAction('comments') }, 'Moderate comments'),
        h(ui.Button, { className: 'sy-btn--sm', onClick: () => onAction('media') }, 'Media and alt text'),
        h(ui.Button, { className: 'sy-btn--sm', onClick: () => onAction('backups') }, 'Snapshots'),
        h(ui.Button, { className: 'sy-btn--sm', onClick: () => onAction('ask') }, 'Ask the AI about the site'))) : null,
    issues.length ? Panel(host, { title: 'Needs attention', wide: true, action: meta(`${issues.length}`) },
      List(host, issues.map((i, k) => ListRow(host, { key: k, lead: h('span', { className: 'mind-dot', style: { background: i.level === 'warn' ? 'var(--sy-brass)' : 'var(--sy-text-3)' } }), label: i.message, sub: i.issue === 'draft' || i.issue === 'pending' ? 'Content' : i.issue === 'comments' ? 'Comments' : i.issue === 'alt' ? 'Media' : i.issue === 'bridge' ? 'Site > bridge' : '', onClick: () => onAction(i.issue === 'comments' ? 'comments' : i.issue === 'alt' ? 'media' : i.issue === 'bridge' ? 'site' : 'insights') })))) : null,
    h('div', { className: 'wp-row2' },
      Panel(host, { title: 'Content types', action: meta(loading ? '' : `${types.length}`) },
        loading ? h(ui.Skeleton, { count: 5, height: 18 }) : types.length ? h('div', { style: { maxHeight: 520, overflow: 'auto', paddingRight: 14, scrollbarGutter: 'stable' } }, List(host, types.map((t) => typeRow(host, t, onOpenType)))) : empty('No content type answers on this site.')),
      Panel(host, { title: 'Changed last', action: meta(loading ? '' : `${(data.recent || []).length}`) },
        loading ? h(ui.Skeleton, { count: 5, height: 18 }) : (data.recent || []).length ? h('div', { style: { maxHeight: 520, overflow: 'auto', paddingRight: 14, scrollbarGutter: 'stable' } }, List(host, data.recent.map((e) => itemRow(host, e, onOpenItem)))) : empty('Nothing changed lately.'))));
}

export function OverviewAside({ host, health, insights, onOpenItem, onOpenType }) {
  const { h, ui } = host;
  const { data } = health;
  const meta = (text) => h('span', { className: 'mpanel__meta' }, text);
  const c = insights.data ? insights.data.counts : null;
  const worst = insights.data ? (insights.data.entries || []).filter((e) => e.issues.some((i) => i !== 'draft' && i !== 'stale')).sort((a, b) => b.issues.length - a.issues.length).slice(0, 15) : [];
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)', flex: 1, minHeight: 0, height: '100%' } },
    Panel(host, { title: 'Issues', action: meta(c ? `${c.total} items read` : '...') },
      c ? Bars(host, { rows: [{ label: 'drafts', value: c.draft }, { label: 'pending', value: c.pending, color: 'var(--sy-brass)' }, { label: 'stale', value: c.stale, color: 'var(--sy-brass)' }, { label: 'no meta title', value: c.missingSeoTitle, color: 'var(--sy-rosin)' }, { label: 'no meta desc', value: c.missingSeoDescription, color: 'var(--sy-rosin)' }, { label: 'too long', value: c.longSeoTitle + c.longSeoDescription, color: 'var(--sy-brass)' }, { label: 'noindex', value: c.noindex, color: 'var(--sy-brass)' }, { label: 'thin', value: c.thin, color: 'var(--sy-rosin)' }, { label: 'no image', value: c.noFeaturedImage, color: 'var(--sy-brass)' }] }) : h(ui.Skeleton, { count: 5, height: 14 })),
    Panel(host, { title: 'Fix first', ...FILL, action: meta(insights.data ? `${worst.length}` : '...') },
      !insights.data ? h(ui.Skeleton, { count: 4, height: 16 }) : worst.length ? List(host, worst.map((e) => ListRow(host, { key: `${e.type}-${e.id}`, lead: h('span', { className: 'mind-dot', style: { background: 'var(--sy-rosin)' } }), label: e.title, sub: `${e.type} - ${e.issues.filter((i) => i !== 'draft' && i !== 'stale').join(', ')}`, onClick: () => onOpenItem(e.restBase, e.id) }))) : h('p', { className: 'mlead', style: { margin: 0 } }, 'Nothing beyond drafts and age.')),
    data && data.plugins && data.plugins.length ? Panel(host, { title: 'Plugins seen', action: meta(`${data.plugins.length}`) }, h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6 } }, data.plugins.map((p) => h(ui.Chip, { key: p.id, title: (p.capabilities || []).join(', ') }, p.label)))) : null);
}
