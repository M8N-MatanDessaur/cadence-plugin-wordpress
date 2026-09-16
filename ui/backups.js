/**
 * Backups: every snapshot taken before a write, newest first, restorable in one click.
 */
import { ago, statusLabel, statusColour } from './helpers.js';
import { Panel, Stat, Health, List, ListRow } from './kit.js';

export function Backups({ host, wp, site, q, onOpenItem }) {
  const { h, ui, notify } = host;
  const { useState, useEffect } = host.react;
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(null);
  const [open, setOpen] = useState(null);
  const load = () => { setData(null); wp('/backups').then((d) => setData(d.items || [])).catch((e) => setData({ error: e.message })); };
  useEffect(load, [site]);
  const meta = (t) => h('span', { className: 'mpanel__meta' }, t);
  const empty = (t) => h('p', { className: 'mlead', style: { margin: 0 } }, t);
  const list = Array.isArray(data) ? data.filter((b) => !q || `${b.title} ${b.restBase} ${b.id} ${b.reason}`.toLowerCase().includes(q)) : [];
  const restore = async (b) => { setBusy(b.backupId); try { const r = await wp(`/restore/${encodeURIComponent(b.backupId)}`, { method: 'POST', body: '{}' }); if (!r || !r.ok) throw new Error((r && r.error) || 'Restore failed'); notify('Restored (the state before was snapshotted too)', 'moss'); load(); } catch (e) { notify(e.message, 'rosin'); } finally { setBusy(null); } };
  const view = async (b) => { try { const r = await wp(`/backup/${encodeURIComponent(b.backupId)}`); setOpen({ ...b, json: JSON.stringify(r.data, null, 2) }); } catch (e) { notify(e.message, 'rosin'); } };
  const byReason = list.reduce((acc, b) => { acc[b.reason] = (acc[b.reason] || 0) + 1; return acc; }, {});
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)' } },
    h('div', { className: 'mstats mstats--head' },
      Stat(host, { label: 'Snapshots', value: !data ? '...' : data.error ? '-' : list.length, tone: 'brass', hint: 'kept on this machine' }),
      Stat(host, { label: 'Automatic', value: !data ? '...' : (byReason.auto || 0) + (byReason['pre-delete'] || 0) + (byReason['pre-restore'] || 0) + (byReason['elementor-pre-edit'] || 0), tone: 'muted', hint: 'before saves, deletes, restores' }),
      Stat(host, { label: 'Manual', value: !data ? '...' : byReason.manual || 0, tone: 'muted' }),
      Stat(host, { label: 'Last', value: !data || !list.length ? '-' : ago(list[0].timestamp), tone: 'muted' })),
    open ? Panel(host, { title: `${open.title || open.id} - ${open.reason}`, wide: true, action: h(ui.Button, { className: 'sy-btn--sm', onClick: () => setOpen(null) }, 'Close') }, h(ui.CodeEditor, { value: open.json, language: 'json', height: 420, readOnly: true })) : null,
    Panel(host, { title: 'Snapshots', wide: true, action: meta(data && !data.error ? `${list.length}` : '') },
      !data ? h(ui.Skeleton, { count: 6, height: 18 }) : data.error ? empty(data.error) : list.length ? h('div', { style: { maxHeight: 640, overflow: 'auto', paddingRight: 14, scrollbarGutter: 'stable' } }, List(host, list.map((b) => ListRow(host, { key: b.backupId, lead: h('span', { className: 'mind-dot', style: { background: statusColour(b.status) } }), label: b.title || `${b.restBase} #${b.id}`, sub: `${b.restBase} #${b.id} - ${statusLabel(b.status)} - ${b.reason} - ${new Date(b.timestamp).toLocaleString()}`, meta: h('span', { style: { display: 'flex', gap: 6 } }, h('button', { type: 'button', className: 'sy-btn sy-btn--sm', onClick: (e) => { e.stopPropagation(); view(b); } }, 'View'), h('button', { type: 'button', className: 'sy-btn sy-btn--sm', disabled: !!busy, onClick: (e) => { e.stopPropagation(); restore(b); } }, busy === b.backupId ? 'Restoring...' : 'Restore')), onClick: () => onOpenItem(b.restBase, b.id) })))) : empty('No snapshot yet. One is taken before every save, trash and restore.')));
}

export function BackupsAside({ host }) {
  const { h } = host;
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)' } },
    Panel(host, { title: 'How snapshots work' }, h('p', { className: 'mlead', style: { margin: 0 } }, 'Before any write to an item - a save, a status change, a trash, a restore - the plugin fetches the item in full and keeps it as JSON on this machine. Restore writes the title, content, excerpt, status, slug, meta, featured image, parent, order and terms back, after snapshotting the current state, so a restore is itself reversible. The newest five hundred are kept.')));
}
