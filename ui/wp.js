/**
 * WordPress in Cadence 3.0: three regions and a header, like the other plugins.
 *
 *   Sidebar: Overview, Content, Media, Comments, Taxonomies, Insights, Backups, Site, Ask,
 *   Sites; the site this screen is on (it follows the repository the active shell is on), a search.
 *   Main: the site as a bento, a post type's items, one item as a form you can edit, schedule,
 *   publish and preview, the media library, comment moderation, terms, the issues, the
 *   snapshots, the site's theme and plugins, questions.
 *   Right: what to fix first, the types, or the item's SEO, backups and facts.
 *
 * Every call carries ?site=<name>, so two screens on two sites never fight over a global
 * active site. Application passwords never reach the browser.
 */
import { ensureStyles, NavItem, Section } from './kit.js';
import { ago, statusLabel } from './helpers.js';
import { useHealth, Overview, OverviewAside } from './overview.js';
import { Types, Items, ContentAside, TypeTools } from './content.js';
import { useItem, ItemPage, ItemAside, NewItem } from './item.js';
import { Media, MediaAside } from './media.js';
import { Comments, CommentsAside } from './comments.js';
import { Terms, TermsAside } from './terms.js';
import { useInsights, Insights, InsightsAside } from './insights.js';
import { Backups, BackupsAside } from './backups.js';
import { Site, SiteAside } from './site.js';
import { Ask } from './ask.js';
import { Sites, SitesAside } from './sites.js';

export const API = '/api/plugins/wordpress';

const NAV = [
  { id: 'overview', label: 'Overview', icon: 'chart', hint: 'The site: content, drafts, comments, media, what needs attention, what changed last.' },
  { id: 'content', label: 'Content', icon: 'list', hint: 'Every post type the site has. Open one to read, edit, schedule, publish and preview it.' },
  { id: 'media', label: 'Media', icon: 'epic', hint: 'The library: images and files, where they are used, their alt text.' },
  { id: 'comments', label: 'Comments', icon: 'comment', hint: 'Moderation: approve, hold, spam, trash, reply.' },
  { id: 'terms', label: 'Taxonomies', icon: 'tag', hint: 'Categories, tags and every custom taxonomy: add, rename, remove.' },
  { id: 'insights', label: 'Insights', icon: 'warning', hint: 'Content with a problem: drafts, stale, missing SEO title or description, noindex, thin, no featured image.' },
  { id: 'backups', label: 'Backups', icon: 'history', hint: 'Snapshots taken before every write. Restore any of them.' },
  { id: 'site', label: 'Site', icon: 'branch', hint: 'The theme, the plugins, the users, the bridge, the repository.' },
  { id: 'ask', label: 'Ask', icon: 'search', hint: 'A question about the site. The AI reads it for you.' },
  { id: 'sites', label: 'Sites', icon: 'story', hint: 'The WordPress sites this workspace knows, their users and repositories.' },
];

function WordPress({ host }) {
  const { h, ui, api, notify, context } = host;
  const { useState, useEffect, useCallback, useMemo } = host.react;
  const [tab, setTab] = useState('overview');
  const [sites, setSites] = useState(null);
  const [site, setSite] = useState(() => { try { return localStorage.getItem('sy.wp.site') || ''; } catch { return ''; } });
  const [q, setQ] = useState('');
  const [openType, setOpenType] = useState(null);
  const [openItem, setOpenItem] = useState(null);
  const [openMedia, setOpenMedia] = useState(null);
  const [openTax, setOpenTax] = useState(null);
  const [mode, setMode] = useState(null);
  useEffect(() => { ensureStyles(); }, []);
  const wp = useCallback((path, opts) => api(`${API}${path}${path.includes('?') ? '&' : '?'}site=${encodeURIComponent(site)}`, opts), [api, site]);
  const loadSites = useCallback(() => api(`${API}/sites`).then((d) => {
    const list = d.sites || [];
    setSites(list);
    const focused = ((context && context()) || {}).focused;
    const norm = (v) => String(v || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    const byRepo = focused && focused.path ? list.find((s) => s.repoPath && norm(s.repoPath) === norm(focused.path)) : null;
    setSite((cur) => (byRepo ? byRepo.name : (cur && list.some((s) => s.name === cur)) ? cur : (d.activeSite && list.some((s) => s.name === d.activeSite)) ? d.activeSite : (list[0] ? list[0].name : '')));
  }).catch((e) => { setSites([]); notify(e.message, 'rosin'); }), [api, context]);
  useEffect(() => { loadSites(); }, [loadSites]);
  useEffect(() => { try { if (site) localStorage.setItem('sy.wp.site', site); } catch {} }, [site]);
  const current = (sites || []).find((s) => s.name === site) || null;
  const configured = !!(current && current.siteUrl && current.username && current.appPasswordSet);
  const health = useHealth(host, wp, site, configured && tab !== 'sites');
  const insights = useInsights(host, wp, site, configured && (tab === 'insights' || tab === 'overview'));
  const item = useItem(host, wp, openItem);
  const leave = () => { setOpenItem(null); setOpenMedia(null); setMode(null); };
  const nav = NAV.find((n) => n.id === tab) || NAV[0];
  const filtered = useMemo(() => q.trim().toLowerCase(), [q]);
  const typeRow = openType && health.data ? (health.data.types || []).find((t) => t.restBase === openType) : null;
  const openTheItem = (restBase, id) => { setTab('content'); setOpenType(restBase); setOpenMedia(null); setMode(null); setOpenItem({ type: restBase, id }); };
  const problems = insights.data ? (insights.data.entries || []).filter((e) => e.issues.some((i) => i !== 'draft' && i !== 'stale')).length : 0;
  const searchable = ['content', 'media', 'comments', 'terms', 'insights', 'backups'].includes(tab);

  const left = h('div', { className: 'sb' },
    h('div', { className: 'sb__head' }, h('span', { className: 'sb__title' }, 'WordPress')),
    h('div', { className: 'mind-stats' },
      !health.data ? h('span', null, sites === null ? 'reading the sites...' : configured ? 'reading the site...' : 'no site configured') : [h('span', { key: 't' }, `${health.data.types.filter((t) => !t.internal && t.slug !== 'attachment').reduce((n, t) => n + t.total, 0)} items`), h('span', { key: 'd' }, `${health.data.counts.drafts} drafts`), h('span', { key: 'm' }, `${health.data.counts.media} media`)]),
    h('ul', { className: 'sb__list', role: 'list' },
      NAV.map((n) => NavItem(host, {
        key: n.id, icon: host.icons[n.icon], label: n.label, active: tab === n.id && !openItem, title: n.hint,
        badge: n.id === 'comments' && health.data && health.data.counts.pendingComments ? health.data.counts.pendingComments : n.id === 'insights' && insights.data ? (problems || undefined) : n.id === 'sites' && sites ? (sites.length || undefined) : undefined,
        onClick: () => { setTab(n.id); leave(); if (n.id !== 'content') setOpenType(null); },
      }))),
    h('div', { style: { flex: 1 } }),
    Section(host, 'Site'),
    h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8, padding: '0 var(--sy-s3) var(--sy-s2)' } },
      h(ui.Select, { value: site, onChange: (e) => { setSite(e.target.value); leave(); setOpenType(null); }, 'aria-label': 'Site' },
        (sites || []).map((s) => h('option', { key: s.name, value: s.name }, s.name)),
        !(sites || []).length ? h('option', { value: '' }, 'No site yet') : null),
      searchable ? h(ui.Input, { value: q, placeholder: tab === 'media' ? 'Search the library' : tab === 'comments' ? 'Search comments' : tab === 'terms' ? 'Search terms' : tab === 'backups' ? 'Search snapshots' : 'Search content', onChange: (e) => setQ(e.target.value), 'aria-label': 'Search' }) : null),
    h('div', { className: 'sb__foot' }, openItem ? 'One item. Back to the type from the header.' : openType ? 'One type. Back to the types from the header.' : nav.hint));

  const header = h('div', { className: 'mind-view__head' },
    h('div', null,
      h('h1', { className: 'stage-title' }, openItem ? (item.data ? item.data.title : 'Item') : openType ? (typeRow ? typeRow.label : openType) : nav.label),
      h('p', { style: { margin: 0, color: 'var(--sy-text-3)', fontSize: 'var(--sy-fs-sm)' } },
        openItem ? `${typeRow ? typeRow.label : openItem.type} - ${item.data ? statusLabel(item.data.status) : 'reading...'}${item.data && item.data.modified ? ` - updated ${ago(item.data.modified)}` : ''}` : openType ? (typeRow ? `${typeRow.total} item${typeRow.total === 1 ? '' : 's'}${typeRow.drafts ? `, ${typeRow.drafts} draft${typeRow.drafts === 1 ? '' : 's'}` : ''}${typeRow.pending ? `, ${typeRow.pending} pending` : ''}${typeRow.scheduled ? `, ${typeRow.scheduled} scheduled` : ''}${typeRow.hierarchical ? ' - hierarchical' : ''}.` : 'A post type.') : `${nav.hint}${site ? ` On ${site}${current ? ` (${current.siteUrl.replace(/^https?:\/\//, '')})` : ''}.` : ''}`)),
    h('div', { className: 'mind-view__actions' },
      current && !openItem ? h('a', { className: 'sy-btn', href: current.adminUrl, target: '_blank', rel: 'noreferrer' }, 'Open wp-admin') : null,
      tab === 'content' && openType && !openItem && !mode ? h(ui.Button, { variant: 'primary', onClick: () => setMode('new') }, 'New') : null,
      openItem ? h(ui.Button, { onClick: () => setOpenItem(null) }, 'Back to the type') : mode ? h(ui.Button, { onClick: () => setMode(null) }, 'Back to the items') : openType ? h(ui.Button, { onClick: () => setOpenType(null) }, 'Back to the types') : h(ui.Button, { onClick: () => { health.reload(true); insights.reload(); loadSites(); } }, 'Refresh')));

  const main = h('div', { style: { padding: '12px 16px 24px', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } },
    sites && !sites.length && tab !== 'sites' ? h(ui.EmptyState, { title: 'No WordPress site yet', body: 'Add one under Sites: its URL, a user, and an application password from that user\'s profile.' })
      : !configured && tab !== 'sites' && sites && sites.length ? h(ui.EmptyState, { title: `${site || 'This site'} is not complete`, body: 'Give it a URL, a user and an application password under Sites.' })
      : openItem
        ? h(ItemPage, { host, wp, site, current, open: openItem, item, typeRow, health, onChanged: () => { item.reload(); health.reload(true); insights.reload(); }, onClose: () => setOpenItem(null), onOpenItem: openTheItem, onDuplicate: (id) => setOpenItem({ type: openItem.type, id }) })
      : tab === 'content'
        ? (openType && mode === 'new' ? h(NewItem, { host, wp, type: openType, typeRow, health, onCreated: (id) => { setMode(null); health.reload(true); setOpenItem({ type: openType, id }); }, onCancel: () => setMode(null) })
          : openType ? h(Items, { host, wp, site, type: openType, typeRow, q: filtered, onOpen: (id) => setOpenItem({ type: openType, id }) })
          : h(Types, { host, health, q: filtered, onOpen: (rb) => { setOpenType(rb); setMode(null); } }))
      : tab === 'media' ? h(Media, { host, wp, site, health, q: filtered, selected: openMedia, onSelect: setOpenMedia })
      : tab === 'comments' ? h(Comments, { host, wp, site, health, q: filtered, onOpenItem: openTheItem, onChanged: () => health.reload(true) })
      : tab === 'terms' ? h(Terms, { host, wp, site, health, q: filtered, open: openTax, onOpen: setOpenTax, onChanged: () => health.reload(true) })
      : tab === 'insights' ? h(Insights, { host, insights, q: filtered, onOpen: openTheItem })
      : tab === 'backups' ? h(Backups, { host, wp, site, q: filtered, onOpenItem: openTheItem })
      : tab === 'site' ? h(Site, { host, wp, site, current, health })
      : tab === 'ask' ? h(Ask, { host, api: API, site, health, onOpen: openTheItem })
      : tab === 'sites' ? h(Sites, { host, api: API, sites, current: site, onChanged: loadSites, onPick: (n) => setSite(n) })
      : h(Overview, { host, health, insights, q: filtered, current, onOpenItem: openTheItem, onOpenType: (rb) => { setTab('content'); setOpenType(rb); setMode(null); }, onAction: (a) => { setTab(a); leave(); } }));

  const right = openItem
    ? h(ItemAside, { host, wp, site, current, open: openItem, item, health, onOpenItem: openTheItem, onChanged: () => { item.reload(); health.reload(true); } })
    : tab === 'content' && openType ? h(TypeTools, { host, wp, type: openType, typeRow, health, mode, setMode })
    : tab === 'content' ? h(ContentAside, { host, health, openType, onOpenType: (rb) => { setOpenType(rb); setMode(null); }, onOpenItem: openTheItem })
    : tab === 'media' ? h(MediaAside, { host, wp, site, selected: openMedia, onOpenItem: openTheItem, onChanged: () => setOpenMedia(openMedia ? { ...openMedia, _bump: Date.now() } : null), onCleared: () => setOpenMedia(null) })
    : tab === 'comments' ? h(CommentsAside, { host, health })
    : tab === 'terms' ? h(TermsAside, { host, health, open: openTax, onOpen: setOpenTax })
    : tab === 'insights' ? h(InsightsAside, { host, insights, onOpen: openTheItem })
    : tab === 'backups' ? h(BackupsAside, { host })
    : tab === 'site' ? h(SiteAside, { host, current, health })
    : tab === 'sites' ? h(SitesAside, { host })
    : h(OverviewAside, { host, health, insights, onOpenItem: openTheItem, onOpenType: (rb) => { setTab('content'); setOpenType(rb); } });

  return h(ui.Regions, { left, right, paneId: `wp-${tab}`, paneLabel: openItem ? 'This item' : tab === 'content' && openType ? 'This type' : tab === 'content' ? 'Types' : tab === 'media' ? 'This file' : tab === 'terms' ? 'Taxonomies' : tab === 'insights' ? 'By type' : tab === 'site' ? 'Repository' : tab === 'sites' ? 'How it works' : 'Attention' },
    h('div', { className: 'wp-main', style: { display: 'flex', flexDirection: 'column', height: 'calc(100vh - 57px)' } }, h('div', { style: { padding: '32px 16px 0', flex: 'none' } }, header), main));
}

WordPress.cadenceComponent = true;
export default WordPress;
