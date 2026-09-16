/**
 * Sites: the WordPress sites this workspace knows. Each has a URL, a user, an application
 * password (typed once, never shown again) and a repository (so the screen can follow the shell).
 */
import { Panel, Stat, List, ListRow } from './kit.js';

function SiteForm({ host, api: API, initial, onDone, onCancel }) {
  const { h, ui, api, notify } = host;
  const { useState } = host.react;
  const editing = !!initial;
  const [name, setName] = useState(initial ? initial.name : '');
  const [siteUrl, setSiteUrl] = useState(initial ? initial.siteUrl || '' : 'https://');
  const [username, setUsername] = useState(initial ? initial.username || '' : '');
  const [appPassword, setAppPassword] = useState('');
  const [repoPath, setRepoPath] = useState(initial ? initial.repoPath || '' : '');
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState(null);
  const pickRepo = async () => { if (!host.pickTarget) return; const t = await host.pickTarget({ title: 'Which repository is this site for?', detail: 'The theme or plugin checkout; the screen follows the shell that is on it.' }); if (t) { setRepoPath(t.path); if (!name) setName(t.repo); } };
  const save = async () => {
    if (!name.trim()) return notify('Give the site a name', 'rosin');
    if (!/^https?:\/\//.test(siteUrl.trim()) || !username.trim()) return notify('A URL and a user are required', 'rosin');
    if (!editing && !appPassword.trim()) return notify('An application password is required', 'rosin');
    setBusy(true);
    try {
      const body = { name: name.trim(), siteUrl: siteUrl.trim(), username: username.trim(), repoPath };
      if (appPassword.trim()) body.appPassword = appPassword.trim();
      if (editing) await api(`${API}/sites/${encodeURIComponent(initial.name)}`, { method: 'PATCH', body: JSON.stringify(body) });
      else await api(`${API}/sites`, { method: 'POST', body: JSON.stringify(body) });
      notify(editing ? 'Site updated' : 'Site added', 'moss'); onDone(name.trim());
    } catch (e) { notify(e.message, 'rosin'); } finally { setBusy(false); }
  };
  const runTest = async () => { if (!editing) return; setTest('...'); try { const r = await api(`${API}/test?site=${encodeURIComponent(initial.name)}`); setTest(r.ok ? `ok - signed in as ${r.user.name} (${(r.user.roles || []).join(', ')})` : r.error || 'failed'); } catch (e) { setTest(e.message); } };
  return Panel(host, { title: editing ? `Edit ${initial.name}` : 'New site', wide: true, action: h('span', { className: 'mpanel__meta' }, 'the password stays on this machine') },
    h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
      h('div', { className: 'wp-row2' },
        h(ui.Field, { label: 'Name', hint: 'as you call it here' }, h(ui.Input, { value: name, placeholder: 'My site', onChange: (e) => setName(e.target.value) })),
        h(ui.Field, { label: 'Site URL' }, h(ui.Input, { value: siteUrl, placeholder: 'https://www.example.com', onChange: (e) => setSiteUrl(e.target.value) }))),
      h('div', { className: 'wp-row2' },
        h(ui.Field, { label: 'User', hint: 'the WordPress login' }, h(ui.Input, { value: username, onChange: (e) => setUsername(e.target.value) })),
        h(ui.Field, { label: editing && initial.appPasswordSet ? 'Application password (blank keeps the stored one)' : 'Application password', hint: 'Users > Profile > Application Passwords in wp-admin' }, h(ui.Input, { type: 'password', value: appPassword, placeholder: 'xxxx xxxx xxxx xxxx xxxx xxxx', onChange: (e) => setAppPassword(e.target.value) }))),
      h(ui.Field, { label: 'Repository', hint: 'the theme or plugin checkout this site belongs to, if any' }, h('div', { style: { display: 'flex', gap: 8 } }, h(ui.Input, { value: repoPath, placeholder: 'C:\\Code\\...', onChange: (e) => setRepoPath(e.target.value), style: { flex: 1 } }), host.pickTarget ? h(ui.Button, { onClick: pickRepo }, 'Choose...') : null)),
      h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
        editing && initial.appPasswordSet ? h(ui.Button, { className: 'sy-btn--sm', onClick: runTest }, 'Test the login') : null,
        test ? h('span', { className: 'mpanel__meta', style: { color: /^ok/.test(test) ? 'var(--sy-moss)' : 'var(--sy-rosin)' } }, test) : null,
        h('span', { style: { flex: 1 } }),
        h(ui.Button, { onClick: onCancel }, 'Cancel'),
        h(ui.Button, { variant: 'primary', disabled: busy, onClick: save }, busy ? 'Saving...' : editing ? 'Save' : 'Add the site'))));
}

export function Sites({ host, api: API, sites, current, onChanged, onPick }) {
  const { h, ui, api, notify } = host;
  const { useState } = host.react;
  const [form, setForm] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const list = sites || [];
  const remove = async (name) => { try { await api(`${API}/sites/${encodeURIComponent(name)}`, { method: 'DELETE' }); notify(`${name} forgotten`, 'moss'); setConfirm(null); onChanged(); } catch (e) { notify(e.message, 'rosin'); } };
  const complete = (s) => s.siteUrl && s.username && s.appPasswordSet;
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)' } },
    h('div', { className: 'mstats mstats--head' },
      Stat(host, { label: 'Sites', value: sites === null ? '...' : list.length, tone: 'brass' }),
      Stat(host, { label: 'With a repository', value: sites === null ? '...' : list.filter((s) => s.repoPath).length, tone: 'muted', hint: 'follow the shell' }),
      Stat(host, { label: 'Incomplete', value: sites === null ? '...' : list.filter((s) => !complete(s)).length, tone: list.some((s) => !complete(s)) ? 'rosin' : 'moss', hint: 'missing URL, user or password' }),
      Stat(host, { label: 'Current', value: current || '-', tone: 'muted' })),
    form !== null ? h(SiteForm, { host, api: API, initial: form === 'new' ? null : form, onDone: (n) => { setForm(null); onChanged(); onPick(n); }, onCancel: () => setForm(null) })
      : Panel(host, { title: 'Sites', wide: true, action: h(ui.Button, { className: 'sy-btn--sm', variant: 'primary', onClick: () => setForm('new') }, 'New site') },
        sites === null ? h(ui.Skeleton, { count: 3, height: 18 }) : list.length ? List(host, list.map((s) => ListRow(host, { key: s.name, lead: h('span', { className: 'mind-dot', style: { background: s.name === current ? 'var(--sy-brass)' : complete(s) ? 'var(--sy-text-3)' : 'var(--sy-rosin)' } }), label: s.name, sub: `${s.siteUrl} - ${s.username}${s.appPasswordSet ? '' : ' - no password'} - ${s.repoPath || 'no repository'}`, meta: h('span', { style: { display: 'flex', gap: 6 } }, s.name !== current ? h('button', { type: 'button', className: 'sy-btn sy-btn--sm', onClick: (e) => { e.stopPropagation(); onPick(s.name); } }, 'Use') : null, h('button', { type: 'button', className: 'sy-btn sy-btn--sm', onClick: (e) => { e.stopPropagation(); setForm(s); } }, 'Edit'), confirm === s.name ? h('button', { type: 'button', className: 'sy-btn sy-btn--sm', style: { color: 'var(--sy-rosin)' }, onClick: (e) => { e.stopPropagation(); remove(s.name); } }, 'Yes, forget it') : h('button', { type: 'button', className: 'sy-btn sy-btn--sm', onClick: (e) => { e.stopPropagation(); setConfirm(s.name); } }, 'Forget')), onClick: () => onPick(s.name) }))) : h('p', { className: 'mlead', style: { margin: 0 } }, 'No site yet. Add one with an application password.')));
}

export function SitesAside({ host }) {
  const { h } = host;
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)' } },
    Panel(host, { title: 'How sites work' }, h('p', { className: 'mlead', style: { margin: 0 } }, 'A site is one WordPress install reached through its REST API with an application password. Give it the repository that holds its theme or plugin and every WordPress screen follows the shell that is on that repository. The password is typed once and never shown again; forgetting a site only removes it from this machine.')),
    Panel(host, { title: 'The application password' }, h('p', { className: 'mlead', style: { margin: 0 } }, 'In wp-admin, open Users > Profile, scroll to Application Passwords, name it Cadence and copy the password it shows once. The user needs the Editor role to write content, Administrator to list plugins and users.')));
}
