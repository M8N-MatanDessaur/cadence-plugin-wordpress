/**
 * Taxonomies: categories, tags and every custom taxonomy. Terms with counts; add, rename,
 * describe, remove. The taxonomy is picked in the right pane.
 */
import { Panel, Stat, Health, List, ListRow, FILL } from './kit.js';

export function Terms({ host, wp, site, health, q, open, onOpen, onChanged }) {
  const { h, ui, notify, tokens } = host;
  const { useState, useEffect } = host.react;
  const taxes = (health.data ? health.data.taxonomies || [] : []).filter((t) => !t.internal);
  const tax = taxes.find((t) => t.restBase === open) || taxes[0] || null;
  const [data, setData] = useState(null);
  const [name, setName] = useState('');
  const [edit, setEdit] = useState(null);
  const [busy, setBusy] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const load = () => { if (!tax) return; setData(null); wp(`/terms/${encodeURIComponent(tax.restBase)}?q=${encodeURIComponent(q || '')}`).then(setData).catch((e) => setData({ error: e.message, terms: [] })); };
  useEffect(load, [tax && tax.restBase, q, site]);
  const meta = (t) => h('span', { className: 'mpanel__meta' }, t);
  const empty = (t) => h('p', { className: 'mlead', style: { margin: 0 } }, t);
  if (!health.data) return h(ui.Skeleton, { count: 6, height: 18 });
  if (!tax) return h(ui.EmptyState, { title: 'No taxonomy', body: 'This site exposes no category, tag or custom taxonomy over its API.' });
  const list = data ? data.terms || [] : [];
  const add = async () => { if (!name.trim()) return; setBusy('add'); try { const r = await wp(`/terms/${encodeURIComponent(tax.restBase)}`, { method: 'POST', body: JSON.stringify({ name: name.trim() }) }); if (!r || !r.id) throw new Error((r && r.message) || 'Could not add'); notify(`Added ${name.trim()}`, 'moss'); setName(''); load(); onChanged(); } catch (e) { notify(e.message, 'rosin'); } finally { setBusy(null); } };
  const save = async () => { if (!edit) return; setBusy('save'); try { const r = await wp(`/terms/${encodeURIComponent(tax.restBase)}/${edit.id}`, { method: 'PATCH', body: JSON.stringify({ name: edit.name, slug: edit.slug, description: edit.description }) }); if (r && r.code) throw new Error(r.message || r.code); notify('Saved', 'moss'); setEdit(null); load(); } catch (e) { notify(e.message, 'rosin'); } finally { setBusy(null); } };
  const remove = async (t) => { setBusy(`del-${t.id}`); try { const r = await wp(`/terms/${encodeURIComponent(tax.restBase)}/${t.id}`, { method: 'DELETE' }); if (r && r.code) throw new Error(r.message || r.code); notify(`Removed ${t.name}`, 'moss'); setConfirm(null); load(); onChanged(); } catch (e) { notify(e.message, 'rosin'); } finally { setBusy(null); } };
  const byParent = (pid, depth) => list.filter((t) => (t.parent || 0) === pid).flatMap((t) => [{ ...t, depth }, ...(tax.hierarchical ? byParent(t.id, depth + 1) : [])]);
  const rows = tax.hierarchical ? byParent(0, 0) : list.map((t) => ({ ...t, depth: 0 }));
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)' } },
    h('div', { className: 'mstats mstats--head' },
      Stat(host, { label: tax.label, value: !data ? '...' : data.total, tone: 'brass', hint: tax.slug }),
      Stat(host, { label: 'In use', value: !data ? '...' : list.filter((t) => t.count).length, tone: 'moss' }),
      Stat(host, { label: 'Unused', value: !data ? '...' : list.filter((t) => !t.count).length, tone: data && list.some((t) => !t.count) ? 'brass' : 'muted' }),
      Stat(host, { label: 'Applies to', value: (tax.types || []).join(', ') || '-', tone: 'muted' })),
    Panel(host, { title: `New ${tax.label.toLowerCase().replace(/s$/, '')}`, wide: true },
      h('div', { style: { display: 'flex', gap: 8 } }, h(ui.Input, { value: name, placeholder: 'Name', onChange: (e) => setName(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter') add(); } }), h(ui.Button, { variant: 'primary', disabled: busy === 'add' || !name.trim(), onClick: add }, busy === 'add' ? 'Adding...' : 'Add'))),
    edit ? Panel(host, { title: `Edit ${edit.name}`, wide: true, action: h(ui.Button, { className: 'sy-btn--sm', onClick: () => setEdit(null) }, 'Close') },
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
        h('div', { className: 'wp-row2' }, h(ui.Field, { label: 'Name' }, h(ui.Input, { value: edit.name, onChange: (e) => setEdit({ ...edit, name: e.target.value }) })), h(ui.Field, { label: 'Slug' }, h(ui.Input, { value: edit.slug, onChange: (e) => setEdit({ ...edit, slug: e.target.value }) }))),
        h(ui.Field, { label: 'Description' }, h(ui.Textarea, { value: edit.description, rows: 2, onChange: (e) => setEdit({ ...edit, description: e.target.value }) })),
        h('div', null, h(ui.Button, { variant: 'primary', disabled: busy === 'save', onClick: save }, busy === 'save' ? 'Saving...' : 'Save')))) : null,
    Panel(host, { title: tax.label, wide: true, action: meta(data ? `${rows.length}` : '') },
      !data ? h(ui.Skeleton, { count: 6, height: 18 }) : data.error ? empty(data.error) : rows.length ? h('div', { style: { maxHeight: 560, overflow: 'auto', paddingRight: 14, scrollbarGutter: 'stable' } }, List(host, rows.map((t) => ListRow(host, { key: t.id, lead: h('span', { className: 'mind-dot', style: { background: t.count ? 'var(--sy-moss)' : 'var(--sy-text-3)', marginLeft: t.depth * 14 } }), label: t.name, sub: `/${t.slug}${t.description ? ` - ${t.description.slice(0, 120)}` : ''}`, meta: h('span', { style: { display: 'flex', gap: 6, alignItems: 'center' } }, h('span', { className: 'mpanel__meta' }, `${t.count}`), h('button', { type: 'button', className: 'sy-btn sy-btn--sm', onClick: (e) => { e.stopPropagation(); setEdit({ id: t.id, name: t.name, slug: t.slug, description: t.description }); } }, 'Edit'), confirm === t.id ? h('button', { type: 'button', className: 'sy-btn sy-btn--sm', style: { color: 'var(--sy-rosin)' }, disabled: !!busy, onClick: (e) => { e.stopPropagation(); remove(t); } }, 'Yes, remove') : h('button', { type: 'button', className: 'sy-btn sy-btn--sm', onClick: (e) => { e.stopPropagation(); setConfirm(t.id); } }, 'Remove')) })))) : empty(q ? 'Nothing matches.' : 'No term yet.')));
}

export function TermsAside({ host, health, open, onOpen }) {
  const { h, ui } = host;
  const taxes = (health.data ? health.data.taxonomies || [] : []).filter((t) => !t.internal);
  const current = taxes.find((t) => t.restBase === open) || taxes[0];
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)', flex: 1, minHeight: 0, height: '100%' } },
    Panel(host, { title: 'Taxonomies', ...FILL, action: h('span', { className: 'mpanel__meta' }, `${taxes.length}`) },
      !health.data ? h(ui.Skeleton, { count: 4, height: 16 }) : taxes.length ? List(host, taxes.map((t) => ListRow(host, { key: t.restBase, lead: h('span', { className: 'mind-dot', style: { background: current && current.restBase === t.restBase ? 'var(--sy-brass)' : 'var(--sy-text-3)' } }), label: t.label, sub: `${t.slug} - ${(t.types || []).join(', ') || 'no type'}`, meta: `${t.count}`, onClick: () => onOpen(t.restBase) }))) : h('p', { className: 'mlead', style: { margin: 0 } }, 'None.')),
    Panel(host, { title: 'Removing a term' }, h('p', { className: 'mlead', style: { margin: 0 } }, 'Removing a term does not remove the items that carry it; they lose that label. Categories fall back to the default one.')));
}
