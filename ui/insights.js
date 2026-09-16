/**
 * Insights: every item with a problem, grouped by the kind of problem. Each row opens the item.
 */
import { ago, statusColour } from './helpers.js';
import { Panel, Stat, Health, List, ListRow } from './kit.js';

export function useInsights(host, wp, site, enabled) {
  const { react } = host;
  const { useState, useEffect, useCallback } = react;
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const reload = useCallback(() => { if (!site || !enabled) return; setError(null); wp('/insights').then((d) => { if (d && d.error) throw new Error(d.error); setData(d); }).catch((e) => { setData(null); setError(e.message); }); }, [wp, site, enabled]);
  useEffect(() => { setData(null); reload(); }, [site, enabled]);
  return { data, error, reload };
}

const KINDS = [
  ['pending', 'Pending review', 'Pending'],
  ['draft', 'Drafts', 'Drafts'],
  ['scheduled', 'Scheduled', 'Scheduled'],
  ['stale', 'Not touched in 180 days', 'Stale'],
  ['missing-seo-title', 'No meta title', 'No title'],
  ['missing-seo-description', 'No meta description', 'No description'],
  ['long-seo-title', 'Meta title over 60', 'Long title'],
  ['long-seo-description', 'Meta description over 160', 'Long description'],
  ['noindex', 'Hidden from search engines', 'noindex'],
  ['thin', 'Under 50 words', 'Thin'],
  ['no-featured-image', 'Posts without a featured image', 'No image'],
  ['no-excerpt', 'Posts without an excerpt', 'No excerpt'],
  ['untitled', 'No title', 'Untitled'],
];
const serious = (e) => e.issues.some((i) => i !== 'draft' && i !== 'stale' && i !== 'scheduled');

export function Insights({ host, insights, q, onOpen }) {
  const { h, ui } = host;
  const { data, error } = insights;
  const { useState } = host.react;
  const [kind, setKind] = useState('');
  const meta = (text) => h('span', { className: 'mpanel__meta' }, text);
  const empty = (text) => h('p', { className: 'mlead', style: { margin: 0 } }, text);
  if (error) return h(ui.EmptyState, { title: 'Could not read the content', body: error });
  const entries = (data ? data.entries || [] : []).filter((e) => e.issues.length && (!q || `${e.title} ${e.type} ${e.slug}`.toLowerCase().includes(q)));
  const c = data ? data.counts : null;
  const row = (e) => ListRow(host, { key: `${e.type}-${e.id}`, lead: h('span', { className: 'mind-dot', style: { background: serious(e) ? 'var(--sy-rosin)' : statusColour(e.status) } }), label: e.title, sub: `${e.type}${e.slug ? ` - /${e.slug}` : ''} - ${e.issues.join(', ')}`, meta: e.modified ? ago(e.modified) : '', onClick: () => onOpen(e.restBase, e.id) });
  const shown = kind ? entries.filter((e) => e.issues.includes(kind)) : entries;
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)' } },
    h('div', { className: 'mstats mstats--head' },
      Stat(host, { label: 'Items read', value: !c ? '...' : c.total, tone: 'brass', hint: data ? data.types.map((t) => t.slug).join(', ') : undefined }),
      Stat(host, { label: 'With a problem', value: !data ? '...' : entries.filter(serious).length, tone: entries.some(serious) ? 'rosin' : 'moss', hint: 'beyond drafts, schedule and age' }),
      Stat(host, { label: 'Without meta description', value: !c ? '...' : c.missingSeoDescription, tone: c && c.missingSeoDescription ? 'rosin' : 'muted', hint: 'published, indexable' }),
      Stat(host, { label: 'Images without alt', value: !c ? '...' : c.imagesNoAlt, tone: c && c.imagesNoAlt ? 'brass' : 'muted', hint: c ? `of ${c.imagesRead} in the library` : undefined })),
    h('div', { className: 'mhealth' }, ...KINDS.map(([k, l]) => Health(host, { key: k, label: l, value: !data ? '...' : entries.filter((e) => e.issues.includes(k)).length }))),
    Panel(host, { title: kind ? KINDS.find(([k]) => k === kind)[1] : 'Everything to look at', wide: true, action: h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } }, h(ui.Chip, { on: !kind, onClick: () => setKind('') }, 'All'), ...KINDS.map(([k, , s]) => h(ui.Chip, { key: k, on: kind === k, onClick: () => setKind(k) }, s))) },
      !data ? h(ui.Skeleton, { count: 8, height: 18 }) : shown.length ? h('div', { style: { maxHeight: 640, overflow: 'auto', paddingRight: 14, scrollbarGutter: 'stable' } }, List(host, shown.slice(0, 300).map(row))) : empty(kind ? 'Nothing of that kind.' : 'Every item is clean.')));
}

export function InsightsAside({ host, insights, onOpen }) {
  const { h, ui } = host;
  const { data } = insights;
  const meta = (text) => h('span', { className: 'mpanel__meta' }, text);
  const types = data ? data.types || [] : [];
  const perType = types.map((t) => ({ name: t.label, count: (data.entries || []).filter((e) => e.type === t.slug && serious(e)).length })).filter((t) => t.count).sort((a, b) => b.count - a.count);
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)' } },
    Panel(host, { title: 'By type', action: meta(data ? `${perType.length}` : '...') },
      !data ? h(ui.Skeleton, { count: 4, height: 16 }) : perType.length ? List(host, perType.map((t) => ListRow(host, { key: t.name, label: t.name, meta: `${t.count}` }))) : h('p', { className: 'mlead', style: { margin: 0 } }, 'No type has a problem beyond drafts and age.')),
    Panel(host, { title: 'How it reads' }, h('p', { className: 'mlead', style: { margin: 0 } }, `Up to 500 items per public post type. Stale means published and untouched for ${data ? data.staleDays : 180} days. Meta title and description are what Yoast or Rank Math render; items marked noindex are not held to them. Thin means under 50 words of plain content on a post or page that no page builder lays out.`)));
}
