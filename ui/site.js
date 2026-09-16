/**
 * Site: the theme, the plugins (when the user may list them), the users, the bridge that
 * lets page-builder writes persist, and the repository this site follows.
 */
import { ago } from './helpers.js';
import { Panel, Stat, Health, List, ListRow } from './kit.js';

export function Site({ host, wp, site, current, health }) {
  const { h, ui, notify } = host;
  const { useState, useEffect } = host.react;
  const [data, setData] = useState(null);
  useEffect(() => { setData(null); wp('/site').then(setData).catch((e) => setData({ error: e.message })); }, [site]);
  const meta = (t) => h('span', { className: 'mpanel__meta' }, t);
  const empty = (t) => h('p', { className: 'mlead', style: { margin: 0 } }, t);
  const plugins = data && Array.isArray(data.plugins) ? data.plugins : null;
  const active = plugins ? plugins.filter((p) => p.status === 'active') : [];
  const detected = health.data ? health.data.plugins || [] : [];
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)' } },
    h('div', { className: 'mstats mstats--head' },
      Stat(host, { label: 'Theme', value: !data ? '...' : data.theme ? data.theme.name : 'unknown', tone: 'brass', hint: data && data.theme ? `${data.theme.version}${data.theme.isChild ? ` - child of ${data.theme.template}` : ''}` : undefined }),
      Stat(host, { label: 'Plugins', value: !data ? '...' : plugins ? `${active.length} active` : 'not listable', tone: 'muted', hint: plugins ? `${plugins.length} installed` : 'the user may not manage plugins' }),
      Stat(host, { label: 'Users', value: !data ? '...' : data.users.length, tone: 'muted' }),
      Stat(host, { label: 'Bridge', value: !data ? '...' : data.bridge ? 'installed' : 'missing', tone: data && data.bridge ? 'moss' : data ? 'brass' : 'muted', hint: 'makes page-builder writes persist' })),
    !data ? null : !data.bridge && detected.some((p) => p.id === 'elementor' || p.id === 'breakdance') ? Panel(host, { title: 'The bridge is missing', wide: true, action: h('a', { className: 'sy-btn sy-btn--sm', href: `/api/plugins/wordpress/bridge/mu-plugin?site=${encodeURIComponent(site)}`, target: '_blank', rel: 'noreferrer' }, 'Download cadence-bridge.php') }, h('p', { className: 'mlead', style: { margin: 0 } }, 'This site uses a page builder. Without the bridge, its layouts can be read but writes to them silently do nothing. Drop the file into wp-content/mu-plugins/ on the server; no activation needed.')) : null,
    h('div', { className: 'wp-row2' },
      Panel(host, { title: 'Plugins', action: meta(!data ? '' : plugins ? `${active.length} of ${plugins.length} active` : `${detected.length} seen`) },
        !data ? h(ui.Skeleton, { count: 6, height: 16 }) : plugins ? h('div', { style: { maxHeight: 480, overflow: 'auto', paddingRight: 14, scrollbarGutter: 'stable' } }, List(host, plugins.sort((a, b) => (a.status === b.status ? a.name.localeCompare(b.name) : a.status === 'active' ? -1 : 1)).map((p) => ListRow(host, { key: p.plugin, lead: h('span', { className: 'mind-dot', style: { background: p.status === 'active' ? 'var(--sy-moss)' : 'var(--sy-text-3)' } }), label: p.name, sub: `${p.status} - ${p.version}${p.author ? ` - ${p.author}` : ''}` })))) : detected.length ? List(host, detected.map((p) => ListRow(host, { key: p.id, lead: h('span', { className: 'mind-dot', style: { background: 'var(--sy-moss)' } }), label: p.label, sub: `seen through its REST namespace - ${(p.capabilities || []).join(', ')}` }))) : empty('The connected user cannot list plugins, and none announces itself.')),
      Panel(host, { title: 'Users', action: meta(data ? `${data.users.length}` : '') },
        !data ? h(ui.Skeleton, { count: 4, height: 16 }) : data.users.length ? List(host, data.users.map((u) => ListRow(host, { key: u.id, lead: h('span', { className: 'mind-dot', style: { background: (u.roles || []).includes('administrator') ? 'var(--sy-brass)' : 'var(--sy-text-3)' } }), label: u.name, sub: `${(u.roles || []).join(', ')}${u.email ? ` - ${u.email}` : ''}`, meta: u.registered ? ago(u.registered) : '' }))) : empty('The connected user cannot list users.'))),
    data && data.theme ? Panel(host, { title: 'Theme', wide: true }, h(ui.InfoGrid, { items: [{ label: 'Name', value: data.theme.name }, { label: 'Version', value: data.theme.version }, { label: 'Stylesheet', value: data.theme.stylesheet }, { label: 'Parent', value: data.theme.isChild ? data.theme.template : 'none' }, { label: 'Author', value: data.theme.author || '-' }, { label: 'REST namespaces', value: (data.namespaces || []).length }] })) : null);
}

export function SiteAside({ host, current, health }) {
  const { h, ui } = host;
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)' } },
    Panel(host, { title: 'Repository' },
      current && current.repoPath ? h('div', null,
        h('p', { className: 'mlead', style: { margin: '0 0 var(--sy-s2)', wordBreak: 'break-all' } }, current.repoPath),
        host.openShell ? h(ui.Button, { variant: 'primary', className: 'sy-btn--sm', onClick: () => host.openShell({ repo: current.name, path: current.repoPath }, { launch: true, label: current.name }) }, 'Start working') : null)
        : h('p', { className: 'mlead', style: { margin: 0 } }, 'No repository on this site. Give it the theme or plugin checkout under Sites and every WordPress screen follows the shell that is on it.')),
    Panel(host, { title: 'wp-admin' }, current ? h('a', { className: 'sy-btn sy-btn--sm', href: current.adminUrl, target: '_blank', rel: 'noreferrer' }, 'Open wp-admin') : null),
    Panel(host, { title: 'The bridge' }, h('p', { className: 'mlead', style: { margin: 0 } }, 'A tiny must-use plugin that registers page-builder and SEO meta with the REST API. Reads work without it; writes to Elementor, Breakdance, Bricks, Beaver and Divi layouts need it.')));
}
