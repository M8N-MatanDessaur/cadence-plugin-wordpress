/**
 * WordPress Plugin -- Server-side API Routes
 *
 * Proxies the WordPress REST API (/wp-json/wp/v2) using Application Password
 * authentication. Supports posts, pages, media, taxonomies, comments, users,
 * search, and SEO metadata (Yoast / RankMath meta fields).
 *
 * All routes are mounted under /api/plugins/wordpress/.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { URL } = require('url');

const configPath = path.join(__dirname, 'config.json');
const backupsDir = path.join(__dirname, 'backups');
const cacheDir = path.join(__dirname, '.cache');
try { if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true }); } catch (_) {}
try { if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true }); } catch (_) {}

// ── Config helpers (multi-site) ───────────────────────────────────────────
function readAllCfg() {
  try {
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    // Migrate legacy flat config (siteUrl at root) to multi-site format
    if (raw.siteUrl !== undefined && !raw.sites) {
      const legacy = { name: raw.siteUrl ? raw.siteUrl.replace(/^https?:\/\//, '').replace(/\/+$/, '') : 'My Site', siteUrl: raw.siteUrl || '', username: raw.username || '', appPassword: raw.appPassword || '' };
      const migrated = { sites: legacy.siteUrl ? [legacy] : [], activeSite: legacy.siteUrl ? legacy.name : '' };
      saveAllCfg(migrated);
      return migrated;
    }
    return { sites: Array.isArray(raw.sites) ? raw.sites : [], activeSite: raw.activeSite || '' };
  } catch (_) { return { sites: [], activeSite: '' }; }
}
function saveAllCfg(data) {
  fs.writeFileSync(configPath, JSON.stringify(data, null, 2), 'utf8');
}
// The site a request asked for by name or by repository path; set at the top of the request
// handler and read synchronously by getCfg() before the handler's first await.
let requestSite = null;
const normPath = (v) => String(v || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
function siteForRepo(all, repoPath) {
  const want = normPath(repoPath);
  if (!want) return null;
  return all.sites.find(s => s.repoPath && normPath(s.repoPath) === want)
    || all.sites.find(s => s.repoPath && (want.startsWith(normPath(s.repoPath) + '/') || normPath(s.repoPath).startsWith(want + '/')))
    || null;
}
function getActiveSite(all) {
  const a = all || readAllCfg();
  if (!a.sites.length) return null;
  if (requestSite) {
    const byName = a.sites.find(s => s.name === requestSite.name);
    if (byName) return byName;
    const byRepo = siteForRepo(a, requestSite.repo);
    if (byRepo) return byRepo;
  }
  const active = a.sites.find(s => s.name === a.activeSite);
  return active || a.sites[0] || null;
}
/** What a site looks like from outside: everything but the application password. */
function publicSite(s) {
  return { name: s.name, siteUrl: s.siteUrl, username: s.username, appPasswordSet: !!s.appPassword, repoPath: s.repoPath || '', adminUrl: (s.siteUrl || '').replace(/\/+$/, '') + '/wp-admin/' };
}
const decodeEntities = (t) => String(t || '').replace(/&#(\d+);/g, (m, n) => String.fromCharCode(Number(n))).replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCharCode(parseInt(n, 16))).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#8217;|&rsquo;/g, "'").replace(/&nbsp;/g, ' ');
const textOf = (v) => decodeEntities(stripHtml(v && typeof v === 'object' ? (v.raw != null ? v.raw : v.rendered) : v));
/** Which builder laid the item out, from its meta. */
function builderOf(meta) {
  const m = meta || {};
  if (m._elementor_edit_mode === 'builder' || (m._elementor_data && String(m._elementor_data).length > 2)) return 'elementor';
  if (m._breakdance_data || m.breakdance_data) return 'breakdance';
  if (m._bricks_page_content_2 || m._bricks_editor_mode === 'bricks') return 'bricks';
  if (m._fl_builder_enabled) return 'beaver';
  if (m._et_pb_use_builder === 'on') return 'divi';
  return null;
}
const editUrlFor = (cfg, builder, id) => { const base = (cfg.siteUrl || '').replace(/\/+$/, ''); if (builder === 'elementor') return base + '/wp-admin/post.php?post=' + id + '&action=elementor'; if (builder === 'breakdance') return base + '/?breakdance=builder&id=' + id; return base + '/wp-admin/post.php?post=' + id + '&action=edit'; };
/** One row per item, the same shape for every post type. */
function rowOf(it, cfg) {
  const meta = it.meta || {};
  const yo = it.yoast_head_json || {};
  const builder = builderOf(meta);
  const content = it.content ? (it.content.raw != null ? it.content.raw : it.content.rendered) : '';
  return {
    id: it.id, type: it.type, title: textOf(it.title) || '(no title)', slug: it.slug, status: it.status, link: it.link, date: it.date, modified: it.modified,
    author: it.author, featuredMedia: it.featured_media || 0, parent: it.parent || 0, menuOrder: it.menu_order,
    excerpt: textOf(it.excerpt).slice(0, 200), words: content ? stripHtml(content).split(/\s+/).filter(Boolean).length : 0,
    builder: builder || (content && /<!-- wp:/.test(content) ? 'gutenberg' : content ? 'classic' : null),
    // What search engines see (rendered by Yoast) first; the stored value may be a %%template%%.
    seoTitle: yo.title || meta._yoast_wpseo_title || meta.rank_math_title || '', seoDescription: yo.description || meta._yoast_wpseo_metadesc || meta.rank_math_description || '', seoTitleStored: meta._yoast_wpseo_title || meta.rank_math_title || '', seoDescriptionStored: meta._yoast_wpseo_metadesc || meta.rank_math_description || '',
    noindex: meta['_yoast_wpseo_meta-robots-noindex'] === '1' || (yo.robots && yo.robots.index === 'noindex') || /noindex/.test(String(meta.rank_math_robots || '')),
    editUrl: editUrlFor(cfg, builder, it.id),
  };
}
/** Every item of a type, page by page, up to a cap. */
async function fetchAllItems(cfg, rb, fields, cap, extra) {
  const out = [];
  let page = 1;
  while (out.length < cap) {
    const r = await wpRequest('GET', apiBase(cfg) + '/' + rb + '?per_page=100&page=' + page + '&status=any&context=edit&_fields=' + fields + (extra ? '&' + extra : ''), cfg);
    if (r.status >= 400 || !Array.isArray(r.data)) break;
    out.push(...r.data);
    const pages = parseInt(r.headers['x-wp-totalpages'] || '1', 10) || 1;
    if (page >= pages) break;
    page++;
  }
  return out.slice(0, cap);
}
/** The Elementor tree, counted: sections, columns, widgets by type, images, text. */
function elementorSummary(data) {
  const out = { sections: 0, columns: 0, containers: 0, widgets: 0, byWidget: {}, images: 0, texts: [] };
  const walk = (nodes) => { for (const n of (Array.isArray(nodes) ? nodes : [])) { if (!n) continue; if (n.elType === 'section') out.sections++; else if (n.elType === 'column') out.columns++; else if (n.elType === 'container') out.containers++; else if (n.elType === 'widget') { out.widgets++; out.byWidget[n.widgetType] = (out.byWidget[n.widgetType] || 0) + 1; const st = n.settings || {}; if (st.image && st.image.url) out.images++; const t = st.title || st.editor || st.text || st.description_text || st.title_text; if (t && out.texts.length < 60) out.texts.push({ widget: n.widgetType, id: n.id, text: stripHtml(String(t)).slice(0, 160) }); } walk(n.elements); } };
  walk(data);
  return out;
}
const INTERNAL_TYPES = new Set(['attachment', 'nav_menu_item', 'wp_block', 'wp_template', 'wp_template_part', 'wp_global_styles', 'wp_navigation', 'wp_font_family', 'wp_font_face', 'jet-engine', 'e-floating-buttons']);
const healthCache = new Map();
const altCache = new Map();
function getCfg() {
  const site = getActiveSite();
  return site || { siteUrl: '', username: '', appPassword: '' };
}
function saveCfg(data) {
  // Update the active site entry in the sites array
  const all = readAllCfg();
  const idx = all.sites.findIndex(s => s.name === all.activeSite);
  if (idx >= 0) {
    all.sites[idx] = Object.assign(all.sites[idx], data);
  }
  saveAllCfg(all);
}
function isConfigured(cfg) {
  return !!(cfg && cfg.siteUrl && cfg.username && cfg.appPassword);
}
function authHeader(cfg) {
  const token = Buffer.from(cfg.username + ':' + cfg.appPassword).toString('base64');
  return 'Basic ' + token;
}
function apiBase(cfg) {
  let base = (cfg.siteUrl || '').replace(/\/+$/, '');
  return base + '/wp-json/wp/v2';
}

// ── HTTP request helper (JSON) ────────────────────────────────────────────
function wpRequest(method, fullUrl, cfg, body, extraHeaders) {
  return new Promise((resolve, reject) => {
    let urlObj;
    try { urlObj = new URL(fullUrl); }
    catch (e) { return reject(new Error('Invalid URL: ' + fullUrl)); }

    const lib = urlObj.protocol === 'http:' ? http : https;
    const headers = Object.assign({
      'Authorization': authHeader(cfg),
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'User-Agent': 'Cadence-WordPress-Plugin',
    }, extraHeaders || {});

    const opts = {
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'http:' ? 80 : 443),
      path: urlObj.pathname + urlObj.search,
      method,
      headers,
    };

    const req = lib.request(opts, (resp) => {
      const chunks = [];
      resp.on('data', c => chunks.push(c));
      resp.on('end', () => {
        const buf = Buffer.concat(chunks);
        const text = buf.toString('utf8');
        let data;
        try { data = JSON.parse(text); }
        catch (_) { data = text; }
        resolve({ status: resp.statusCode || 0, headers: resp.headers, data, raw: buf });
      });
    });
    req.on('error', reject);
    // A host that never answers used to hold the screen for the whole TCP timeout (a minute or
    // more on Windows) with nothing said. Twelve seconds is long for a healthy site.
    req.setTimeout(12000, () => { req.destroy(new Error(`${urlObj.hostname} did not answer within 12 seconds`)); });
    if (body !== undefined && body !== null) {
      if (Buffer.isBuffer(body) || typeof body === 'string') req.write(body);
      else req.write(JSON.stringify(body));
    }
    req.end();
  });
}

// ── Binary upload helper (for media) ──────────────────────────────────────
function wpUploadBinary(cfg, buffer, filename, mimeType) {
  const url = apiBase(cfg) + '/media';
  return wpRequest('POST', url, cfg, buffer, {
    'Content-Type': mimeType || 'application/octet-stream',
    'Content-Disposition': 'attachment; filename="' + filename.replace(/"/g, '') + '"',
    'Content-Length': buffer.length,
  });
}

// ── Utility: strip HTML to plain text for summaries ───────────────────────
function stripHtml(s) {
  if (!s) return '';
  return String(s).replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

// ── Icon hint for post type slug (UI only) ───────────────────────────────
function iconForType(slug) {
  const s = String(slug || '').toLowerCase();
  if (s === 'post') return 'file-text';
  if (s === 'page') return 'file';
  if (s === 'attachment') return 'image';
  if (s === 'product' || s.includes('product')) return 'shopping-bag';
  if (s.includes('popup') || s.includes('jet-popup')) return 'message-square';
  if (s.includes('elementor') || s === 'elementor_library') return 'layout';
  if (s.includes('service')) return 'briefcase';
  if (s.includes('project') || s.includes('portfolio')) return 'grid';
  if (s.includes('team') || s.includes('staff') || s.includes('member')) return 'users';
  if (s.includes('tour')) return 'compass';
  if (s.includes('form')) return 'clipboard';
  if (s.includes('event')) return 'calendar';
  if (s.includes('testim')) return 'star';
  if (s.includes('faq')) return 'help-circle';
  if (s.includes('menu')) return 'menu';
  return 'box';
}

// ── Detect well-known plugins from exposed REST namespaces ───────────────
function detectPluginsFromNamespaces(namespaces) {
  const ns = new Set((namespaces || []).map(s => String(s || '').toLowerCase()));
  const detected = [];
  const add = (id, label, source, cap) => detected.push({ id, label, source, capabilities: cap });
  if ([...ns].some(n => n.includes('wc/') || n === 'wc/v3' || n.includes('woocommerce'))) {
    add('woocommerce', 'WooCommerce', 'namespace', ['products', 'orders', 'customers']);
  }
  if ([...ns].some(n => n.includes('elementor'))) {
    add('elementor', 'Elementor', 'namespace', ['templates', 'library', 'widgets']);
  }
  if ([...ns].some(n => n.includes('breakdance'))) {
    add('breakdance', 'Breakdance', 'namespace', ['builder', 'templates']);
  }
  if ([...ns].some(n => n.includes('oxygen') || n.includes('ct_builder'))) {
    add('oxygen', 'Oxygen Builder', 'namespace', ['builder', 'templates']);
  }
  if ([...ns].some(n => n.includes('bricks'))) {
    add('bricks', 'Bricks Builder', 'namespace', ['builder', 'templates']);
  }
  if ([...ns].some(n => n.includes('beaver') || n.includes('fl-builder'))) {
    add('beaver', 'Beaver Builder', 'namespace', ['builder', 'templates']);
  }
  if ([...ns].some(n => n.includes('divi') || n.includes('et_'))) {
    add('divi', 'Divi Builder', 'namespace', ['builder', 'templates']);
  }
  if ([...ns].some(n => n.includes('jet-') || n.includes('crocoblock'))) {
    add('jetengine', 'JetEngine / Crocoblock', 'namespace', ['cpts', 'relations', 'popups']);
  }
  if ([...ns].some(n => n.includes('filebird'))) {
    add('filebird', 'FileBird', 'namespace', ['folders', 'media-tree']);
  }
  if ([...ns].some(n => n.includes('yoast'))) {
    add('yoast', 'Yoast SEO', 'namespace', ['seo-meta']);
  }
  if ([...ns].some(n => n.includes('rankmath') || n.includes('rank-math'))) {
    add('rankmath', 'Rank Math SEO', 'namespace', ['seo-meta']);
  }
  if ([...ns].some(n => n.includes('acf') || n.includes('advanced-custom-fields'))) {
    add('acf', 'Advanced Custom Fields', 'namespace', ['custom-fields']);
  }
  if ([...ns].some(n => n.includes('wpforms') || n.includes('gravityforms') || n.includes('gf/v2'))) {
    add('forms', 'Forms plugin', 'namespace', ['forms', 'entries']);
  }
  if ([...ns].some(n => n.includes('polylang') || n.includes('wpml'))) {
    add('i18n', 'Translation plugin', 'namespace', ['languages']);
  }
  return detected;
}

// ── Backups ──────────────────────────────────────────────────────────────
const backupsIndexPath = () => path.join(backupsDir, 'index.json');
function readBackupsIndex() {
  try { return JSON.parse(fs.readFileSync(backupsIndexPath(), 'utf8')); }
  catch (_) { return { items: [] }; }
}
function writeBackupsIndex(idx) {
  try { fs.writeFileSync(backupsIndexPath(), JSON.stringify(idx, null, 2), 'utf8'); } catch (_) {}
}
function listBackups() {
  const idx = readBackupsIndex();
  const items = Array.isArray(idx.items) ? idx.items.slice() : [];
  items.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
  return items;
}
async function createBackup(cfg, restBase, id, reason) {
  // Fetch the full editable item (context=edit gives raw fields)
  const url = apiBase(cfg) + '/' + restBase + '/' + id + '?context=edit';
  const r = await wpRequest('GET', url, cfg);
  if (!r.data || (r.status >= 400)) {
    throw new Error('Could not fetch item for backup (' + (r.status || 0) + ')');
  }
  const ts = new Date().toISOString();
  const bid = ts.replace(/[:.]/g, '-') + '-' + restBase + '-' + id;
  const titleRaw = (r.data.title && (r.data.title.raw || r.data.title.rendered)) || '';
  const snapshot = {
    id: String(id),
    backupId: bid,
    restBase,
    timestamp: ts,
    reason: reason || 'manual',
    siteUrl: cfg.siteUrl,
    title: String(titleRaw).replace(/<[^>]*>/g, '').slice(0, 120),
    link: r.data.link || '',
    status: r.data.status || '',
    data: r.data,
  };
  fs.writeFileSync(path.join(backupsDir, bid + '.json'), JSON.stringify(snapshot, null, 2), 'utf8');
  const idx = readBackupsIndex();
  idx.items = idx.items || [];
  idx.items.push({
    backupId: bid,
    restBase,
    id: String(id),
    title: snapshot.title,
    status: snapshot.status,
    reason: snapshot.reason,
    timestamp: ts,
    siteUrl: cfg.siteUrl,
  });
  // Cap index at 500 most recent to avoid unbounded growth
  if (idx.items.length > 500) {
    const trimmed = idx.items.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || '')).slice(0, 500);
    idx.items = trimmed;
  }
  writeBackupsIndex(idx);
  return idx.items[idx.items.length - 1];
}

// ── MIME type sniff from extension ────────────────────────────────────────
function mimeFromExt(filename) {
  const ext = path.extname(filename || '').toLowerCase();
  const map = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
    '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
    '.pdf': 'application/pdf', '.mp4': 'video/mp4', '.webm': 'video/webm',
    '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
    '.zip': 'application/zip', '.txt': 'text/plain',
  };
  return map[ext] || 'application/octet-stream';
}

// ── Route handler ─────────────────────────────────────────────────────────

// ---- Attention: what the Plugins home shows on this app's tile. Reads the plugin's own
// routes over loopback (they carry their caches), never writes, answers within a minute.
const __attention = { value: null, until: 0 };
function __selfGet(req, path, timeoutMs) {
  return new Promise((resolve) => {
    const host = req.headers.host || `127.0.0.1:${process.env.CADENCE_PORT || 3801}`;
    const lib = require('http');
    const r = lib.get({ host: host.split(':')[0], port: Number(host.split(':')[1] || 80), path, headers: { 'x-cadence-internal': '1' } }, (resp) => { let d = ''; resp.on('data', (c) => { d += c; }); resp.on('end', () => { try { resolve(resp.statusCode < 400 ? JSON.parse(d) : null); } catch (_) { resolve(null); } }); });
    r.on('error', () => resolve(null));
    r.setTimeout(timeoutMs || 45000, () => { r.destroy(); resolve(null); });
  });
}
function __attentionOut(items) {
  const rank = { error: 3, warn: 2, warning: 2, info: 1 };
  const list = (items || []).filter((i) => i && i.text).map((i) => ({ level: i.level === 'warning' ? 'warn' : (i.level || 'info'), text: String(i.text) }));
  const level = list.reduce((top, i) => (rank[i.level] > rank[top] ? i.level : top), list.length ? 'info' : 'ok');
  return { count: list.length, level, items: list, readAt: new Date().toISOString() };
}
async function __attentionHandler(req, res, url, compute, json) {
  if (__attention.value && __attention.until > Date.now() && url.searchParams.get('refresh') !== '1') return json(res, __attention.value);
  let out;
  try { out = __attentionOut(await compute(req)); } catch (e) { out = { count: 0, level: 'ok', items: [], error: e.message, readAt: new Date().toISOString() }; }
  __attention.value = out; __attention.until = Date.now() + 60000;
  return json(res, out);
}

module.exports = function ({ addRoute, addPrefixRoute, json, readBody, shell }) {
  addRoute('GET', '/attention', (req, res, url) => __attentionHandler(req, res, url, async (req) => { const h = await __selfGet(req, '/api/plugins/wordpress/health'); return (h && h.issues || []).map((i) => ({ level: i.level, text: i.message })); }, json));
  const permGate = shell && typeof shell.permGate === 'function' ? shell.permGate : null;
  const gate = async (res, route, label) => (permGate ? permGate(res, 'api', route, label) : true);
  addPrefixRoute(async (req, res, url, subpath) => {
    const method = req.method;
    requestSite = (url.searchParams.get('site') || url.searchParams.get('repo')) ? { name: url.searchParams.get('site') || '', repo: url.searchParams.get('repo') || '' } : null;
    try {
      // ── The @wp handle's search ─────────────────────────────────────
      // "@wp pricing" in the palette, or an Ask Cadence question about something, arrives
      // here and is answered in the shape every handle shares. WordPress's own /search
      // covers posts, pages and every public type in one call; a numeric id resolves to a
      // post before it ever gets here.
      if (subpath === '/search' && method === 'GET') {
        const cfg = getCfg();
        if (!isConfigured(cfg)) return json(res, { items: [] });
        const q = String(url.searchParams.get('q') || '').trim();
        const limit = Math.max(1, Math.min(25, Number(url.searchParams.get('limit')) || 8));
        if (!q) return json(res, { items: [] });
        const r = await wpRequest('GET', apiBase(cfg) + '/search?search=' + encodeURIComponent(q) + '&per_page=' + limit + '&_embed=1', cfg);
        const items = (Array.isArray(r.data) ? r.data : []).map((hit) => {
          const sub = String(hit.subtype || hit.type || 'post');
          const restBase = sub === 'page' ? 'pages' : sub === 'post' ? 'posts' : sub;
          return {
            kind: sub, id: String(hit.id),
            label: String(hit.title || ('#' + hit.id)).replace(/<[^>]*>/g, ''),
            detail: [cfg.name, sub].filter(Boolean).join(' - '),
            open: { surface: 'wordpress', target: { type: restBase, id: String(hit.id), site: cfg.name } },
            score: 0.7,
          };
        });
        return json(res, { items });
      }

      // ── Config (active site) ────────────────────────────────────────
      if (subpath === '/config' && method === 'GET') {
        const cfg = getCfg();
        const all = readAllCfg();
        return json(res, {
          configured: isConfigured(cfg),
          siteUrl: cfg.siteUrl || '',
          username: cfg.username || '',
          appPasswordSet: !!cfg.appPassword,
          activeSite: all.activeSite || '',
        });
      }
      if (subpath === '/config' && method === 'POST') {
        const body = await readBody(req);
        const cfg = getCfg();
        if (body.siteUrl !== undefined) cfg.siteUrl = String(body.siteUrl).trim().replace(/\/+$/, '');
        if (body.username !== undefined) cfg.username = String(body.username).trim();
        if (body.appPassword !== undefined) cfg.appPassword = String(body.appPassword);
        saveCfg(cfg);
        return json(res, { ok: true });
      }

      // ── Sites (multi-site management) ─────────────────────────────
      if (subpath === '/sites' && method === 'GET') {
        const all = readAllCfg();
        return json(res, {
          sites: all.sites.map(publicSite),
          activeSite: all.activeSite || '',
        });
      }
      if (subpath === '/sites' && method === 'POST') {
        const body = await readBody(req);
        if (!body.name || !body.siteUrl || !body.username || !body.appPassword) {
          return json(res, { error: 'name, siteUrl, username, and appPassword are all required.' }, 400);
        }
        const all = readAllCfg();
        const name = String(body.name).trim();
        if (all.sites.find(s => s.name === name)) {
          return json(res, { error: 'A site with that name already exists.' }, 409);
        }
        all.sites.push({
          name,
          siteUrl: String(body.siteUrl).trim().replace(/\/+$/, ''),
          username: String(body.username).trim(),
          appPassword: String(body.appPassword),
          repoPath: body.repoPath ? String(body.repoPath).trim().replace(/\/+$/, '') : '',
        });
        if (!all.activeSite) all.activeSite = name;
        saveAllCfg(all);
        return json(res, { ok: true });
      }
      if (subpath === '/sites/active' && method === 'POST') {
        const body = await readBody(req);
        if (!body.name) return json(res, { error: 'name is required.' }, 400);
        const all = readAllCfg();
        const site = all.sites.find(s => s.name === body.name);
        if (!site) return json(res, { error: 'Site not found.' }, 404);
        all.activeSite = body.name;
        saveAllCfg(all);
        return json(res, { ok: true, activeSite: body.name });
      }
      if (subpath.startsWith('/sites/') && subpath !== '/sites/active' && (method === 'PUT' || method === 'PATCH')) {
        const siteName = decodeURIComponent(subpath.slice('/sites/'.length));
        const body = await readBody(req);
        const all = readAllCfg();
        const idx = all.sites.findIndex(s => s.name === siteName);
        if (idx < 0) return json(res, { error: 'Site not found.' }, 404);
        if (body.name !== undefined) {
          const newName = String(body.name).trim();
          if (newName !== siteName && all.sites.find(s => s.name === newName)) {
            return json(res, { error: 'A site with that name already exists.' }, 409);
          }
          if (all.activeSite === siteName) all.activeSite = newName;
          all.sites[idx].name = newName;
        }
        if (body.siteUrl !== undefined) all.sites[idx].siteUrl = String(body.siteUrl).trim().replace(/\/+$/, '');
        if (body.username !== undefined) all.sites[idx].username = String(body.username).trim();
        // A blank password keeps the stored one; the form never has to show it.
        if (body.appPassword !== undefined && String(body.appPassword)) all.sites[idx].appPassword = String(body.appPassword);
        if (body.repoPath !== undefined) all.sites[idx].repoPath = String(body.repoPath).trim().replace(/\/+$/, '');
        saveAllCfg(all);
        healthCache.clear();
        return json(res, { ok: true });
      }
      if (subpath.startsWith('/sites/') && subpath !== '/sites/active' && method === 'DELETE') {
        const siteName = decodeURIComponent(subpath.slice('/sites/'.length));
        const all = readAllCfg();
        const idx = all.sites.findIndex(s => s.name === siteName);
        if (idx < 0) return json(res, { error: 'Site not found.' }, 404);
        if (!(await gate(res, 'DELETE /api/plugins/wordpress/sites', `Forget the WordPress site ${siteName}`))) return;
        all.sites.splice(idx, 1);
        if (all.activeSite === siteName) all.activeSite = all.sites.length ? all.sites[0].name : '';
        saveAllCfg(all);
        return json(res, { ok: true, activeSite: all.activeSite });
      }

      // ── Test connection ────────────────────────────────────────────
      if (subpath === '/test' && method === 'GET') {
        const cfg = getCfg();
        if (!isConfigured(cfg)) return json(res, { ok: false, error: 'Not configured' });
        try {
          const r = await wpRequest('GET', apiBase(cfg) + '/users/me?context=edit', cfg);
          if (r.status >= 200 && r.status < 300) {
            return json(res, {
              ok: true,
              user: {
                id: r.data.id,
                name: r.data.name,
                slug: r.data.slug,
                email: r.data.email,
                roles: r.data.roles || [],
                link: r.data.link,
              },
              siteUrl: cfg.siteUrl,
            });
          }
          return json(res, { ok: false, error: (r.data && r.data.message) || ('HTTP ' + r.status) });
        } catch (e) {
          return json(res, { ok: false, error: e.message });
        }
      }

      // ── Summary (plain text, AI-friendly) ──────────────────────────
      if (subpath === '/summary' && method === 'GET') {
        const cfg = getCfg();
        if (!isConfigured(cfg)) return json(res, { error: 'Not configured' }, 401);
        const lines = ['WordPress Site Summary', '======================', ''];
        try {
          const meR = await wpRequest('GET', apiBase(cfg) + '/users/me?context=edit', cfg);
          if (meR.data && meR.data.name) {
            lines.push('Site: ' + cfg.siteUrl);
            lines.push('Logged in as: ' + meR.data.name + ' (' + (meR.data.roles || []).join(', ') + ')');
            lines.push('');
          }
          // Counts via _fields=id with per_page=1 reading headers
          const countOf = async (type) => {
            const r = await wpRequest('GET', apiBase(cfg) + '/' + type + '?status=any&per_page=1&_fields=id', cfg);
            return parseInt(r.headers['x-wp-total'] || '0', 10);
          };
          const [posts, pages, media, comments, cats, tags, users] = await Promise.all([
            countOf('posts').catch(() => 0),
            countOf('pages').catch(() => 0),
            countOf('media').catch(() => 0),
            countOf('comments').catch(() => 0),
            countOf('categories').catch(() => 0),
            countOf('tags').catch(() => 0),
            countOf('users').catch(() => 0),
          ]);
          lines.push('Content counts:');
          lines.push('  Posts:      ' + posts);
          lines.push('  Pages:      ' + pages);
          lines.push('  Media:      ' + media);
          lines.push('  Comments:   ' + comments);
          lines.push('  Categories: ' + cats);
          lines.push('  Tags:       ' + tags);
          lines.push('  Users:      ' + users);
          lines.push('');

          // Recent posts
          const recR = await wpRequest('GET', apiBase(cfg) + '/posts?status=any&per_page=10&orderby=modified&order=desc&_fields=id,title,status,modified,link', cfg);
          if (Array.isArray(recR.data) && recR.data.length) {
            lines.push('Recent posts (10):');
            for (const p of recR.data) {
              const t = (p.title && (p.title.rendered || p.title)) || '(no title)';
              lines.push('  [' + (p.status || '?') + '] ' + stripHtml(t) + '  (id:' + p.id + ', modified:' + (p.modified || '').slice(0, 10) + ')');
            }
            lines.push('');
          }

          // Pending comments
          const pendR = await wpRequest('GET', apiBase(cfg) + '/comments?status=hold&per_page=5&_fields=id,author_name,post,content', cfg);
          if (Array.isArray(pendR.data) && pendR.data.length) {
            lines.push('Comments awaiting moderation (' + pendR.data.length + '):');
            for (const c of pendR.data) {
              const body = stripHtml(c.content && c.content.rendered || '').slice(0, 80);
              lines.push('  - ' + (c.author_name || 'anon') + ': ' + body + '  (id:' + c.id + ')');
            }
            lines.push('');
          }
        } catch (e) {
          lines.push('Error building summary: ' + e.message);
        }
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end(lines.join('\n'));
      }

      // ── Generic passthrough helpers ────────────────────────────────
      const cfgRequired = () => {
        const cfg = getCfg();
        if (!isConfigured(cfg)) {
          json(res, { error: 'WordPress plugin not configured. Set siteUrl, username, appPassword in plugin settings.' }, 401);
          return null;
        }
        return cfg;
      };

      const passQuery = (wpPath) => {
        // Append all current query params to the WP URL
        const qs = url.search || '';
        return apiBase(cfgRequired() ? getCfg() : { siteUrl: '' }) + wpPath + qs;
      };

      // ── Posts ──────────────────────────────────────────────────────
      if (subpath === '/posts' && method === 'GET') {
        const cfg = cfgRequired(); if (!cfg) return true;
        // Default to any status so drafts show up (requires auth)
        const sp = new URL(url.toString());
        if (!sp.searchParams.has('status')) sp.searchParams.set('status', 'any');
        if (!sp.searchParams.has('per_page')) sp.searchParams.set('per_page', '20');
        if (!sp.searchParams.has('context')) sp.searchParams.set('context', 'edit');
        const r = await wpRequest('GET', apiBase(cfg) + '/posts' + (sp.search || ''), cfg);
        return json(res, { total: r.headers['x-wp-total'], totalPages: r.headers['x-wp-totalpages'], items: r.data }, r.status);
      }
      const postIdMatch = subpath.match(/^\/posts\/(\d+)$/);
      if (postIdMatch && method === 'GET') {
        const cfg = cfgRequired(); if (!cfg) return true;
        const r = await wpRequest('GET', apiBase(cfg) + '/posts/' + postIdMatch[1] + '?context=edit', cfg);
        return json(res, r.data, r.status);
      }
      if (subpath === '/posts' && method === 'POST') {
        const cfg = cfgRequired(); if (!cfg) return true;
        const body = await readBody(req);
        const r = await wpRequest('POST', apiBase(cfg) + '/posts', cfg, body);
        return json(res, r.data, r.status);
      }
      if (postIdMatch && (method === 'PUT' || method === 'PATCH')) {
        const cfg = cfgRequired(); if (!cfg) return true;
        const body = await readBody(req);
        const r = await wpRequest('POST', apiBase(cfg) + '/posts/' + postIdMatch[1], cfg, body);
        return json(res, r.data, r.status);
      }
      if (postIdMatch && method === 'DELETE') {
        const cfg = cfgRequired(); if (!cfg) return true;
        const force = url.searchParams.get('force') === 'true' ? '?force=true' : '';
        const r = await wpRequest('DELETE', apiBase(cfg) + '/posts/' + postIdMatch[1] + force, cfg);
        return json(res, r.data, r.status);
      }

      // ── Pages ──────────────────────────────────────────────────────
      if (subpath === '/pages' && method === 'GET') {
        const cfg = cfgRequired(); if (!cfg) return true;
        const sp = new URL(url.toString());
        if (!sp.searchParams.has('status')) sp.searchParams.set('status', 'any');
        if (!sp.searchParams.has('per_page')) sp.searchParams.set('per_page', '20');
        if (!sp.searchParams.has('context')) sp.searchParams.set('context', 'edit');
        const r = await wpRequest('GET', apiBase(cfg) + '/pages' + (sp.search || ''), cfg);
        return json(res, { total: r.headers['x-wp-total'], totalPages: r.headers['x-wp-totalpages'], items: r.data }, r.status);
      }
      const pageIdMatch = subpath.match(/^\/pages\/(\d+)$/);
      if (pageIdMatch && method === 'GET') {
        const cfg = cfgRequired(); if (!cfg) return true;
        const r = await wpRequest('GET', apiBase(cfg) + '/pages/' + pageIdMatch[1] + '?context=edit', cfg);
        return json(res, r.data, r.status);
      }
      if (subpath === '/pages' && method === 'POST') {
        const cfg = cfgRequired(); if (!cfg) return true;
        const body = await readBody(req);
        const r = await wpRequest('POST', apiBase(cfg) + '/pages', cfg, body);
        return json(res, r.data, r.status);
      }
      if (pageIdMatch && (method === 'PUT' || method === 'PATCH')) {
        const cfg = cfgRequired(); if (!cfg) return true;
        const body = await readBody(req);
        const r = await wpRequest('POST', apiBase(cfg) + '/pages/' + pageIdMatch[1], cfg, body);
        return json(res, r.data, r.status);
      }
      if (pageIdMatch && method === 'DELETE') {
        const cfg = cfgRequired(); if (!cfg) return true;
        const force = url.searchParams.get('force') === 'true' ? '?force=true' : '';
        const r = await wpRequest('DELETE', apiBase(cfg) + '/pages/' + pageIdMatch[1] + force, cfg);
        return json(res, r.data, r.status);
      }

      // ── Media ──────────────────────────────────────────────────────
      if (subpath === '/media' && method === 'GET') {
        const cfg = cfgRequired(); if (!cfg) return true;
        const sp = new URL(url.toString());
        if (!sp.searchParams.has('per_page')) sp.searchParams.set('per_page', '24');
        if (!sp.searchParams.has('context')) sp.searchParams.set('context', 'edit');
        const r = await wpRequest('GET', apiBase(cfg) + '/media' + (sp.search || ''), cfg);
        return json(res, { total: r.headers['x-wp-total'], totalPages: r.headers['x-wp-totalpages'], items: r.data }, r.status);
      }
      const mediaIdMatch = subpath.match(/^\/media\/(\d+)$/);
      if (mediaIdMatch && method === 'GET') {
        const cfg = cfgRequired(); if (!cfg) return true;
        const r = await wpRequest('GET', apiBase(cfg) + '/media/' + mediaIdMatch[1] + '?context=edit', cfg);
        return json(res, r.data, r.status);
      }
      if (mediaIdMatch && (method === 'PUT' || method === 'PATCH')) {
        const cfg = cfgRequired(); if (!cfg) return true;
        const body = await readBody(req);
        const r = await wpRequest('POST', apiBase(cfg) + '/media/' + mediaIdMatch[1], cfg, body);
        return json(res, r.data, r.status);
      }
      if (mediaIdMatch && method === 'DELETE') {
        const cfg = cfgRequired(); if (!cfg) return true;
        if (!(await gate(res, 'DELETE /api/plugins/wordpress/media', `Permanently delete WordPress media ${mediaIdMatch[1]}`))) return;
        // Media must force=true to actually delete (no trash)
        const r = await wpRequest('DELETE', apiBase(cfg) + '/media/' + mediaIdMatch[1] + '?force=true', cfg);
        return json(res, r.data, r.status);
      }
      // Upload media from local file path
      if (subpath === '/media/upload' && method === 'POST') {
        const cfg = cfgRequired(); if (!cfg) return true;
        const body = await readBody(req);
        if (!body.filePath) return json(res, { error: 'filePath required (absolute path to local file)' }, 400);
        if (!fs.existsSync(body.filePath)) return json(res, { error: 'File not found: ' + body.filePath }, 404);
        const buffer = fs.readFileSync(body.filePath);
        const filename = body.filename || path.basename(body.filePath);
        const mime = body.mimeType || mimeFromExt(filename);
        const uploadR = await wpUploadBinary(cfg, buffer, filename, mime);
        if (uploadR.status >= 300 || !uploadR.data || !uploadR.data.id) {
          return json(res, { error: 'Upload failed', details: uploadR.data }, uploadR.status || 500);
        }
        // Optional metadata patch (alt_text, caption, description, title)
        const meta = {};
        ['alt_text', 'caption', 'description', 'title', 'post'].forEach(k => {
          if (body[k] !== undefined) meta[k] = body[k];
        });
        if (Object.keys(meta).length) {
          const patchR = await wpRequest('POST', apiBase(cfg) + '/media/' + uploadR.data.id, cfg, meta);
          return json(res, patchR.data, patchR.status);
        }
        return json(res, uploadR.data, 201);
      }
      // Upload media from remote URL (download then upload)
      if (subpath === '/media/upload-url' && method === 'POST') {
        const cfg = cfgRequired(); if (!cfg) return true;
        const body = await readBody(req);
        if (!body.url) return json(res, { error: 'url required' }, 400);
        const downloaded = await new Promise((resolve, reject) => {
          const lib = body.url.startsWith('http://') ? http : https;
          lib.get(body.url, (resp) => {
            if (resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location) {
              // follow one redirect
              lib.get(resp.headers.location, (r2) => {
                const chunks = [];
                r2.on('data', c => chunks.push(c));
                r2.on('end', () => resolve({ buffer: Buffer.concat(chunks), contentType: r2.headers['content-type'] }));
                r2.on('error', reject);
              }).on('error', reject);
              return;
            }
            const chunks = [];
            resp.on('data', c => chunks.push(c));
            resp.on('end', () => resolve({ buffer: Buffer.concat(chunks), contentType: resp.headers['content-type'] }));
            resp.on('error', reject);
          }).on('error', reject);
        });
        const urlObj = new URL(body.url);
        const filename = body.filename || path.basename(urlObj.pathname) || 'download';
        const mime = body.mimeType || downloaded.contentType || mimeFromExt(filename);
        const uploadR = await wpUploadBinary(cfg, downloaded.buffer, filename, mime);
        if (uploadR.status >= 300 || !uploadR.data || !uploadR.data.id) {
          return json(res, { error: 'Upload failed', details: uploadR.data }, uploadR.status || 500);
        }
        const meta = {};
        ['alt_text', 'caption', 'description', 'title', 'post'].forEach(k => {
          if (body[k] !== undefined) meta[k] = body[k];
        });
        if (Object.keys(meta).length) {
          const patchR = await wpRequest('POST', apiBase(cfg) + '/media/' + uploadR.data.id, cfg, meta);
          return json(res, patchR.data, patchR.status);
        }
        return json(res, uploadR.data, 201);
      }

      // ── Categories ─────────────────────────────────────────────────
      if (subpath === '/categories' && method === 'GET') {
        const cfg = cfgRequired(); if (!cfg) return true;
        const sp = new URL(url.toString());
        if (!sp.searchParams.has('per_page')) sp.searchParams.set('per_page', '100');
        const r = await wpRequest('GET', apiBase(cfg) + '/categories' + (sp.search || ''), cfg);
        return json(res, r.data, r.status);
      }
      const catIdMatch = subpath.match(/^\/categories\/(\d+)$/);
      if (catIdMatch && method === 'GET') {
        const cfg = cfgRequired(); if (!cfg) return true;
        const r = await wpRequest('GET', apiBase(cfg) + '/categories/' + catIdMatch[1], cfg);
        return json(res, r.data, r.status);
      }
      if (subpath === '/categories' && method === 'POST') {
        const cfg = cfgRequired(); if (!cfg) return true;
        const body = await readBody(req);
        const r = await wpRequest('POST', apiBase(cfg) + '/categories', cfg, body);
        return json(res, r.data, r.status);
      }
      if (catIdMatch && (method === 'PUT' || method === 'PATCH')) {
        const cfg = cfgRequired(); if (!cfg) return true;
        const body = await readBody(req);
        const r = await wpRequest('POST', apiBase(cfg) + '/categories/' + catIdMatch[1], cfg, body);
        return json(res, r.data, r.status);
      }
      if (catIdMatch && method === 'DELETE') {
        const cfg = cfgRequired(); if (!cfg) return true;
        const r = await wpRequest('DELETE', apiBase(cfg) + '/categories/' + catIdMatch[1] + '?force=true', cfg);
        return json(res, r.data, r.status);
      }

      // ── Tags ───────────────────────────────────────────────────────
      if (subpath === '/tags' && method === 'GET') {
        const cfg = cfgRequired(); if (!cfg) return true;
        const sp = new URL(url.toString());
        if (!sp.searchParams.has('per_page')) sp.searchParams.set('per_page', '100');
        const r = await wpRequest('GET', apiBase(cfg) + '/tags' + (sp.search || ''), cfg);
        return json(res, r.data, r.status);
      }
      const tagIdMatch = subpath.match(/^\/tags\/(\d+)$/);
      if (tagIdMatch && method === 'GET') {
        const cfg = cfgRequired(); if (!cfg) return true;
        const r = await wpRequest('GET', apiBase(cfg) + '/tags/' + tagIdMatch[1], cfg);
        return json(res, r.data, r.status);
      }
      if (subpath === '/tags' && method === 'POST') {
        const cfg = cfgRequired(); if (!cfg) return true;
        const body = await readBody(req);
        const r = await wpRequest('POST', apiBase(cfg) + '/tags', cfg, body);
        return json(res, r.data, r.status);
      }
      if (tagIdMatch && (method === 'PUT' || method === 'PATCH')) {
        const cfg = cfgRequired(); if (!cfg) return true;
        const body = await readBody(req);
        const r = await wpRequest('POST', apiBase(cfg) + '/tags/' + tagIdMatch[1], cfg, body);
        return json(res, r.data, r.status);
      }
      if (tagIdMatch && method === 'DELETE') {
        const cfg = cfgRequired(); if (!cfg) return true;
        const r = await wpRequest('DELETE', apiBase(cfg) + '/tags/' + tagIdMatch[1] + '?force=true', cfg);
        return json(res, r.data, r.status);
      }

      // ── Comments ───────────────────────────────────────────────────
      if (subpath === '/comments' && method === 'GET') {
        const cfg = cfgRequired(); if (!cfg) return true;
        const sp = new URL(url.toString());
        if (!sp.searchParams.has('per_page')) sp.searchParams.set('per_page', '30');
        if (!sp.searchParams.has('context')) sp.searchParams.set('context', 'edit');
        const r = await wpRequest('GET', apiBase(cfg) + '/comments' + (sp.search || ''), cfg);
        return json(res, { total: r.headers['x-wp-total'], items: r.data }, r.status);
      }
      const commentIdMatch = subpath.match(/^\/comments\/(\d+)$/);
      if (commentIdMatch && method === 'GET') {
        const cfg = cfgRequired(); if (!cfg) return true;
        const r = await wpRequest('GET', apiBase(cfg) + '/comments/' + commentIdMatch[1] + '?context=edit', cfg);
        return json(res, r.data, r.status);
      }
      if (subpath === '/comments' && method === 'POST') {
        const cfg = cfgRequired(); if (!cfg) return true;
        const body = await readBody(req);
        const r = await wpRequest('POST', apiBase(cfg) + '/comments', cfg, body);
        return json(res, r.data, r.status);
      }
      if (commentIdMatch && (method === 'PUT' || method === 'PATCH')) {
        const cfg = cfgRequired(); if (!cfg) return true;
        const body = await readBody(req);
        const r = await wpRequest('POST', apiBase(cfg) + '/comments/' + commentIdMatch[1], cfg, body);
        return json(res, r.data, r.status);
      }
      if (commentIdMatch && method === 'DELETE') {
        const cfg = cfgRequired(); if (!cfg) return true;
        const force = url.searchParams.get('force') === 'true' ? '?force=true' : '';
        const r = await wpRequest('DELETE', apiBase(cfg) + '/comments/' + commentIdMatch[1] + force, cfg);
        return json(res, r.data, r.status);
      }
      // Shortcut: approve / hold / spam / trash
      const commentStatusMatch = subpath.match(/^\/comments\/(\d+)\/(approve|hold|spam|trash)$/);
      if (commentStatusMatch && method === 'POST') {
        const cfg = cfgRequired(); if (!cfg) return true;
        const id = commentStatusMatch[1];
        const action = commentStatusMatch[2];
        const statusMap = { approve: 'approved', hold: 'hold', spam: 'spam', trash: 'trash' };
        const r = await wpRequest('POST', apiBase(cfg) + '/comments/' + id, cfg, { status: statusMap[action] });
        return json(res, r.data, r.status);
      }

      // ── Users ──────────────────────────────────────────────────────
      if (subpath === '/users' && method === 'GET') {
        const cfg = cfgRequired(); if (!cfg) return true;
        const sp = new URL(url.toString());
        if (!sp.searchParams.has('per_page')) sp.searchParams.set('per_page', '50');
        if (!sp.searchParams.has('context')) sp.searchParams.set('context', 'edit');
        const r = await wpRequest('GET', apiBase(cfg) + '/users' + (sp.search || ''), cfg);
        return json(res, r.data, r.status);
      }
      if (subpath === '/users/me' && method === 'GET') {
        const cfg = cfgRequired(); if (!cfg) return true;
        const r = await wpRequest('GET', apiBase(cfg) + '/users/me?context=edit', cfg);
        return json(res, r.data, r.status);
      }
      const userIdMatch = subpath.match(/^\/users\/(\d+)$/);
      if (userIdMatch && method === 'GET') {
        const cfg = cfgRequired(); if (!cfg) return true;
        const r = await wpRequest('GET', apiBase(cfg) + '/users/' + userIdMatch[1] + '?context=edit', cfg);
        return json(res, r.data, r.status);
      }

      // ── Search ─────────────────────────────────────────────────────
      if (subpath === '/search' && method === 'GET') {
        const cfg = cfgRequired(); if (!cfg) return true;
        const q = url.searchParams.get('q') || '';
        if (!q) return json(res, []);
        const type = url.searchParams.get('type') || ''; // post, page, etc.
        const sp = new URLSearchParams();
        sp.set('search', q);
        sp.set('per_page', url.searchParams.get('per_page') || '20');
        if (type) sp.set('type', type);
        const r = await wpRequest('GET', apiBase(cfg) + '/search?' + sp.toString(), cfg);
        return json(res, r.data, r.status);
      }

      // ── SEO (Yoast / RankMath via post meta) ───────────────────────
      // GET /seo/:type/:id  -> read known SEO meta fields
      // PUT /seo/:type/:id  -> update known SEO meta fields
      const seoMatch = subpath.match(/^\/seo\/([a-zA-Z0-9_\-]+)\/(\d+)$/);
      if (seoMatch) {
        const cfg = cfgRequired(); if (!cfg) return true;
        const type = seoMatch[1];
        const id = seoMatch[2];
        if (method === 'GET') {
          const r = await wpRequest('GET', apiBase(cfg) + '/' + type + '/' + id + '?context=edit', cfg);
          const meta = (r.data && r.data.meta) || {};
          const yoast = (r.data && r.data.yoast_head_json) || null;
          return json(res, {
            id: r.data && r.data.id,
            title: r.data && r.data.title && r.data.title.rendered,
            link: r.data && r.data.link,
            yoast: {
              title: meta._yoast_wpseo_title || '',
              metadesc: meta._yoast_wpseo_metadesc || '',
              focuskw: meta._yoast_wpseo_focuskw || '',
              canonical: meta._yoast_wpseo_canonical || '',
              opengraph_title: meta['_yoast_wpseo_opengraph-title'] || '',
              opengraph_description: meta['_yoast_wpseo_opengraph-description'] || '',
              opengraph_image: meta['_yoast_wpseo_opengraph-image'] || '',
              twitter_title: meta['_yoast_wpseo_twitter-title'] || '',
              twitter_description: meta['_yoast_wpseo_twitter-description'] || '',
              twitter_image: meta['_yoast_wpseo_twitter-image'] || '',
              meta_robots_noindex: meta['_yoast_wpseo_meta-robots-noindex'] || '',
              meta_robots_nofollow: meta['_yoast_wpseo_meta-robots-nofollow'] || '',
            },
            rankmath: {
              title: meta.rank_math_title || '',
              description: meta.rank_math_description || '',
              focus_keyword: meta.rank_math_focus_keyword || '',
              canonical_url: meta.rank_math_canonical_url || '',
              facebook_title: meta.rank_math_facebook_title || '',
              facebook_description: meta.rank_math_facebook_description || '',
              twitter_title: meta.rank_math_twitter_title || '',
              twitter_description: meta.rank_math_twitter_description || '',
              robots: meta.rank_math_robots || '',
            },
            rendered_head: yoast,
          }, r.status);
        }
        if (method === 'PUT' || method === 'PATCH' || method === 'POST') {
          const body = await readBody(req);
          const meta = {};
          // Yoast fields
          const yoastMap = {
            title: '_yoast_wpseo_title',
            metadesc: '_yoast_wpseo_metadesc',
            focuskw: '_yoast_wpseo_focuskw',
            canonical: '_yoast_wpseo_canonical',
            opengraph_title: '_yoast_wpseo_opengraph-title',
            opengraph_description: '_yoast_wpseo_opengraph-description',
            opengraph_image: '_yoast_wpseo_opengraph-image',
            twitter_title: '_yoast_wpseo_twitter-title',
            twitter_description: '_yoast_wpseo_twitter-description',
            twitter_image: '_yoast_wpseo_twitter-image',
            meta_robots_noindex: '_yoast_wpseo_meta-robots-noindex',
            meta_robots_nofollow: '_yoast_wpseo_meta-robots-nofollow',
          };
          if (body.yoast) {
            for (const k in yoastMap) if (body.yoast[k] !== undefined) meta[yoastMap[k]] = body.yoast[k];
          }
          // RankMath fields
          const rmMap = {
            title: 'rank_math_title',
            description: 'rank_math_description',
            focus_keyword: 'rank_math_focus_keyword',
            canonical_url: 'rank_math_canonical_url',
            facebook_title: 'rank_math_facebook_title',
            facebook_description: 'rank_math_facebook_description',
            twitter_title: 'rank_math_twitter_title',
            twitter_description: 'rank_math_twitter_description',
            robots: 'rank_math_robots',
          };
          if (body.rankmath) {
            for (const k in rmMap) if (body.rankmath[k] !== undefined) meta[rmMap[k]] = body.rankmath[k];
          }
          // Raw meta passthrough
          if (body.meta) Object.assign(meta, body.meta);
          const r = await wpRequest('POST', apiBase(cfg) + '/' + type + '/' + id, cfg, { meta });
          return json(res, r.data, r.status);
        }
      }

      // ── Site info (root /wp-json) ──────────────────────────────────
      if (subpath === '/info' && method === 'GET') {
        const cfg = cfgRequired(); if (!cfg) return true;
        const root = (cfg.siteUrl || '').replace(/\/+$/, '') + '/wp-json';
        const r = await wpRequest('GET', root, cfg);
        const d = r.data || {};
        return json(res, {
          name: d.name,
          description: d.description,
          url: d.url,
          home: d.home,
          gmt_offset: d.gmt_offset,
          timezone_string: d.timezone_string,
          namespaces: d.namespaces,
          authentication: d.authentication,
          site_logo: d.site_logo,
          site_icon: d.site_icon,
        }, r.status);
      }

      // ── Statuses & post types ──────────────────────────────────────
      if (subpath === '/statuses' && method === 'GET') {
        const cfg = cfgRequired(); if (!cfg) return true;
        const r = await wpRequest('GET', apiBase(cfg) + '/statuses?context=edit', cfg);
        return json(res, r.data, r.status);
      }
      if (subpath === '/types' && method === 'GET') {
        const cfg = cfgRequired(); if (!cfg) return true;
        const r = await wpRequest('GET', apiBase(cfg) + '/types?context=edit', cfg);
        return json(res, r.data, r.status);
      }

      // ── Discover: post types, taxonomies, counts (dynamic sidebar) ──
      // Returns everything the sidebar needs in one call. Empty sections
      // are still returned with count 0; UI decides whether to hide them.
      if (subpath === '/discover' && method === 'GET') {
        const cfg = cfgRequired(); if (!cfg) return true;
        const result = {
          site: { url: cfg.siteUrl, name: '', description: '' },
          postTypes: [],   // [{ slug, label, restBase, count, hierarchical, icon, source }]
          taxonomies: [],  // [{ slug, label, restBase, count, types }]
          namespaces: [],  // [{ ns, label, source }]
          plugins: [],     // [{ id, label, source, capabilities }] -- detected from namespaces
        };

        // 1. Site info from /wp-json root (gives namespaces list = hint at active plugins)
        try {
          const rootR = await wpRequest('GET', (cfg.siteUrl || '').replace(/\/+$/, '') + '/wp-json', cfg);
          if (rootR.data) {
            result.site.name = rootR.data.name || '';
            result.site.description = rootR.data.description || '';
            result.namespaces = Array.isArray(rootR.data.namespaces) ? rootR.data.namespaces : [];
          }
        } catch (_) {}

        // 2. Post types (core + custom from any plugin)
        try {
          const typesR = await wpRequest('GET', apiBase(cfg) + '/types?context=edit', cfg);
          if (typesR.data && typeof typesR.data === 'object') {
            for (const key of Object.keys(typesR.data)) {
              const t = typesR.data[key];
              if (!t || !t.rest_base) continue;
              // Skip attachment here; media has its own handling
              if (key === 'attachment') {
                result.postTypes.push({
                  slug: key,
                  label: (t.labels && t.labels.name) || t.name || key,
                  restBase: t.rest_base,
                  count: 0,
                  hierarchical: !!t.hierarchical,
                  icon: 'image',
                  source: 'core',
                  viewable: !!t.viewable,
                });
                continue;
              }
              result.postTypes.push({
                slug: key,
                label: (t.labels && t.labels.name) || t.name || key,
                restBase: t.rest_base,
                count: 0,
                hierarchical: !!t.hierarchical,
                icon: iconForType(key),
                source: key === 'post' || key === 'page' || key === 'attachment' ? 'core' : 'custom',
                viewable: !!t.viewable,
              });
            }
          }
        } catch (_) {}

        // 3. Taxonomies
        try {
          const taxR = await wpRequest('GET', apiBase(cfg) + '/taxonomies?context=edit', cfg);
          if (taxR.data && typeof taxR.data === 'object') {
            for (const key of Object.keys(taxR.data)) {
              const t = taxR.data[key];
              if (!t || !t.rest_base) continue;
              result.taxonomies.push({
                slug: key,
                label: (t.labels && t.labels.name) || t.name || key,
                restBase: t.rest_base,
                count: 0,
                types: Array.isArray(t.types) ? t.types : [],
                hierarchical: !!t.hierarchical,
                source: key === 'category' || key === 'post_tag' || key === 'nav_menu' || key === 'link_category' || key === 'post_format' ? 'core' : 'custom',
              });
            }
          }
        } catch (_) {}

        // 4. Counts -- parallel x-wp-total reads
        const countUrl = (rb) => apiBase(cfg) + '/' + rb + '?per_page=1&_fields=id&context=edit';
        const countAttachment = () => apiBase(cfg) + '/media?per_page=1&_fields=id';
        const countStatusAny = (rb) => apiBase(cfg) + '/' + rb + '?per_page=1&_fields=id&status=any&context=edit';

        const ptPromises = result.postTypes.map(async (pt) => {
          try {
            const u = pt.slug === 'attachment' ? countAttachment() : countStatusAny(pt.restBase);
            const r = await wpRequest('GET', u, cfg);
            pt.count = parseInt(r.headers['x-wp-total'] || '0', 10) || 0;
          } catch (_) { pt.count = 0; }
        });
        const taxPromises = result.taxonomies.map(async (tx) => {
          try {
            const r = await wpRequest('GET', countUrl(tx.restBase), cfg);
            tx.count = parseInt(r.headers['x-wp-total'] || '0', 10) || 0;
          } catch (_) { tx.count = 0; }
        });
        // Comments as a pseudo-section (not a post type)
        let commentCount = 0;
        const commentsP = wpRequest('GET', apiBase(cfg) + '/comments?per_page=1&_fields=id&context=edit', cfg)
          .then(r => { commentCount = parseInt(r.headers['x-wp-total'] || '0', 10) || 0; })
          .catch(() => {});
        // Users
        let userCount = 0;
        const usersP = wpRequest('GET', apiBase(cfg) + '/users?per_page=1&_fields=id&context=edit', cfg)
          .then(r => { userCount = parseInt(r.headers['x-wp-total'] || '0', 10) || 0; })
          .catch(() => {});

        await Promise.all([...ptPromises, ...taxPromises, commentsP, usersP]);
        result.commentCount = commentCount;
        result.userCount = userCount;

        // 5. Plugin detection from namespaces
        result.plugins = detectPluginsFromNamespaces(result.namespaces);

        return json(res, result);
      }

      // ── Generic content-type list / CRUD ────────────────────────────
      // GET /content/:restBase                list items
      // GET /content/:restBase/:id            get one
      // POST /content/:restBase               create
      // PUT /content/:restBase/:id            update
      // DELETE /content/:restBase/:id         delete
      // This lets the UI handle ANY post type (Elementor templates, Woo
      // products, JetPopup popups, custom CPTs) without hardcoding endpoints.
      const contentListMatch = subpath.match(/^\/content\/([a-zA-Z0-9_\-]+)$/);
      const contentItemMatch = subpath.match(/^\/content\/([a-zA-Z0-9_\-]+)\/(\d+)$/);
      if (contentListMatch && method === 'GET') {
        const cfg = cfgRequired(); if (!cfg) return true;
        const rb = contentListMatch[1];
        const sp = new URL(url.toString());
        if (!sp.searchParams.has('per_page')) sp.searchParams.set('per_page', '30');
        if (!sp.searchParams.has('context')) sp.searchParams.set('context', 'edit');
        if (!sp.searchParams.has('status')) sp.searchParams.set('status', 'any');
        const r = await wpRequest('GET', apiBase(cfg) + '/' + rb + (sp.search || ''), cfg);
        return json(res, {
          total: r.headers['x-wp-total'],
          totalPages: r.headers['x-wp-totalpages'],
          items: Array.isArray(r.data) ? r.data : [],
        }, r.status);
      }
      if (contentItemMatch && method === 'GET') {
        const cfg = cfgRequired(); if (!cfg) return true;
        const r = await wpRequest('GET', apiBase(cfg) + '/' + contentItemMatch[1] + '/' + contentItemMatch[2] + '?context=edit', cfg);
        return json(res, r.data, r.status);
      }
      if (contentListMatch && method === 'POST') {
        const cfg = cfgRequired(); if (!cfg) return true;
        const body = await readBody(req);
        const r = await wpRequest('POST', apiBase(cfg) + '/' + contentListMatch[1], cfg, body);
        healthCache.clear();
        return json(res, r.data, r.status);
      }
      if (contentItemMatch && (method === 'PUT' || method === 'PATCH')) {
        const cfg = cfgRequired(); if (!cfg) return true;
        const body = await readBody(req);
        // Auto-backup before mutate (fire-and-forget; don't block save if it fails)
        try { await createBackup(cfg, contentItemMatch[1], contentItemMatch[2], 'auto'); } catch (_) {}
        const r = await wpRequest('POST', apiBase(cfg) + '/' + contentItemMatch[1] + '/' + contentItemMatch[2], cfg, body);
        healthCache.clear();
        return json(res, r.data, r.status);
      }
      if (contentItemMatch && method === 'DELETE') {
        const cfg = cfgRequired(); if (!cfg) return true;
        if (!(await gate(res, 'DELETE /api/plugins/wordpress/content', `${url.searchParams.get('force') === 'true' ? 'Permanently delete' : 'Trash'} WordPress ${contentItemMatch[1]} ${contentItemMatch[2]}`))) return;
        try { await createBackup(cfg, contentItemMatch[1], contentItemMatch[2], 'pre-delete'); } catch (_) {}
        const force = url.searchParams.get('force') === 'true' ? '?force=true' : '';
        const r = await wpRequest('DELETE', apiBase(cfg) + '/' + contentItemMatch[1] + '/' + contentItemMatch[2] + force, cfg);
        return json(res, r.data, r.status);
      }

      // ── Elementor endpoints ─────────────────────────────────────────
      // List Elementor library templates (sections, pages, widgets saved by users)
      if (subpath === '/elementor/templates' && method === 'GET') {
        const cfg = cfgRequired(); if (!cfg) return true;
        try {
          // Try the core WP REST library first (most reliable)
          const r = await wpRequest('GET',
            apiBase(cfg) + '/elementor_library?per_page=100&context=edit&status=any', cfg);
          if (r.status >= 400) {
            return json(res, {
              error: 'Elementor library not accessible via REST. Ensure Elementor is active and the user has edit permissions.',
              status: r.status,
            }, r.status);
          }
          const items = Array.isArray(r.data) ? r.data : [];
          return json(res, {
            total: r.headers['x-wp-total'],
            items: items.map(t => ({
              id: t.id,
              title: (t.title && (t.title.rendered || t.title.raw)) || '',
              slug: t.slug,
              type: (t.meta && t.meta._elementor_template_type) || 'unknown', // page, section, header, footer, widget, popup
              status: t.status,
              modified: t.modified,
              editUrl: (cfg.siteUrl || '').replace(/\/+$/, '') + '/wp-admin/post.php?post=' + t.id + '&action=elementor',
            })),
          });
        } catch (e) {
          return json(res, { error: e.message }, 500);
        }
      }

      // Get the raw Elementor layout data for a page/post
      // GET /elementor/page/:id
      const elementorPageMatch = subpath.match(/^\/elementor\/page\/(\d+)$/);
      if (elementorPageMatch && method === 'GET') {
        const cfg = cfgRequired(); if (!cfg) return true;
        const id = elementorPageMatch[1];
        // We need to figure out the post type first
        let postType = url.searchParams.get('type') || 'pages';
        try {
          const r = await wpRequest('GET', apiBase(cfg) + '/' + postType + '/' + id + '?context=edit', cfg);
          if (r.status >= 400) {
            return json(res, { error: 'Page not found', status: r.status }, r.status);
          }
          const p = r.data || {};
          const meta = p.meta || {};
          let elementorData = meta._elementor_data;
          // _elementor_data is stored as a JSON string
          if (typeof elementorData === 'string') {
            try { elementorData = JSON.parse(elementorData); } catch (_) {}
          }
          return json(res, {
            id: p.id,
            title: (p.title && (p.title.rendered || p.title.raw)) || '',
            summary: Array.isArray(elementorData) ? elementorSummary(elementorData) : null,
            editMode: meta._elementor_edit_mode || (Array.isArray(elementorData) && elementorData.length ? 'builder' : null),
            version: meta._elementor_version || null,
            template: meta._elementor_template_type || null,
            data: elementorData || null,
            css: meta._elementor_css || null,
            link: p.link,
            editUrl: (cfg.siteUrl || '').replace(/\/+$/, '') + '/wp-admin/post.php?post=' + id + '&action=elementor',
          });
        } catch (e) {
          return json(res, { error: e.message }, 500);
        }
      }

      // Update a page's Elementor data (meta _elementor_data)
      // PUT /elementor/page/:id  body: { data: [...elementor json...], type: 'pages' }
      if (elementorPageMatch && (method === 'PUT' || method === 'POST')) {
        const cfg = cfgRequired(); if (!cfg) return true;
        const id = elementorPageMatch[1];
        const body = await readBody(req);
        const postType = (body && body.type) || url.searchParams.get('type') || 'pages';
        if (!body || !body.data) {
          return json(res, { error: 'body.data (Elementor JSON array) is required' }, 400);
        }
        // Backup first
        try { await createBackup(cfg, postType, id, 'elementor-pre-edit'); } catch (_) {}
        // Writes to _elementor_data require the meta field to be registered with show_in_rest.
        // WordPress by default does not expose it. This call will succeed only if a companion
        // must-use plugin has registered the meta. We attempt it and return a clear error if
        // it silently succeeds but does not persist.
        const dataString = typeof body.data === 'string' ? body.data : JSON.stringify(body.data);
        const r = await wpRequest('POST', apiBase(cfg) + '/' + postType + '/' + id, cfg, {
          meta: {
            _elementor_data: dataString,
            _elementor_edit_mode: 'builder',
          },
        });
        return json(res, {
          ok: r.status < 400,
          status: r.status,
          note: 'If the response is 200 but the editor does not reflect the change, the site is missing a must-use plugin that registers _elementor_data with show_in_rest=true. See /api/plugins/instructions for the required snippet.',
          data: r.data,
        }, r.status);
      }

      // Clone an Elementor template or page onto a new draft
      // POST /elementor/clone  body: { sourceId, sourceType, targetType, title }
      if (subpath === '/elementor/clone' && method === 'POST') {
        const cfg = cfgRequired(); if (!cfg) return true;
        const body = await readBody(req);
        if (!body || !body.sourceId) return json(res, { error: 'sourceId is required' }, 400);
        const sourceType = body.sourceType || 'pages';
        const targetType = body.targetType || 'pages';
        try {
          const src = await wpRequest('GET', apiBase(cfg) + '/' + sourceType + '/' + body.sourceId + '?context=edit', cfg);
          if (src.status >= 400) return json(res, { error: 'Source not found' }, src.status);
          const srcMeta = (src.data && src.data.meta) || {};
          const newPost = {
            title: body.title || 'Clone of ' + ((src.data.title && src.data.title.rendered) || body.sourceId),
            status: 'draft',
            content: (src.data.content && src.data.content.raw) || '',
            meta: {
              _elementor_data: srcMeta._elementor_data || '',
              _elementor_edit_mode: 'builder',
              _elementor_version: srcMeta._elementor_version || '',
              _elementor_template_type: srcMeta._elementor_template_type || 'wp-page',
            },
          };
          const created = await wpRequest('POST', apiBase(cfg) + '/' + targetType, cfg, newPost);
          return json(res, {
            ok: created.status < 400,
            status: created.status,
            newId: created.data && created.data.id,
            editUrl: (cfg.siteUrl || '').replace(/\/+$/, '') + '/wp-admin/post.php?post=' + (created.data && created.data.id) + '&action=elementor',
          }, created.status);
        } catch (e) {
          return json(res, { error: e.message }, 500);
        }
      }

      // ── Breakdance endpoints ────────────────────────────────────────
      // List Breakdance templates/headers/footers/popups by custom post type
      if (subpath === '/breakdance/templates' && method === 'GET') {
        const cfg = cfgRequired(); if (!cfg) return true;
        try {
          // Breakdance uses several CPTs: breakdance_template, breakdance_header,
          // breakdance_footer, breakdance_popup, breakdance_block, breakdance_form
          const types = ['breakdance_template', 'breakdance_header', 'breakdance_footer', 'breakdance_popup', 'breakdance_block'];
          const results = {};
          for (const t of types) {
            try {
              const r = await wpRequest('GET', apiBase(cfg) + '/' + t + '?per_page=100&context=edit&status=any', cfg);
              if (r.status < 400 && Array.isArray(r.data)) {
                results[t] = r.data.map(x => ({
                  id: x.id,
                  title: (x.title && (x.title.rendered || x.title.raw)) || '',
                  slug: x.slug,
                  status: x.status,
                  editUrl: (cfg.siteUrl || '').replace(/\/+$/, '') + '/?breakdance=builder&id=' + x.id,
                }));
              }
            } catch (_) {}
          }
          return json(res, results);
        } catch (e) {
          return json(res, { error: e.message }, 500);
        }
      }

      // Get Breakdance data for a page
      const breakdancePageMatch = subpath.match(/^\/breakdance\/page\/(\d+)$/);
      if (breakdancePageMatch && method === 'GET') {
        const cfg = cfgRequired(); if (!cfg) return true;
        const id = breakdancePageMatch[1];
        const postType = url.searchParams.get('type') || 'pages';
        try {
          const r = await wpRequest('GET', apiBase(cfg) + '/' + postType + '/' + id + '?context=edit', cfg);
          if (r.status >= 400) return json(res, { error: 'Page not found' }, r.status);
          const meta = (r.data && r.data.meta) || {};
          return json(res, {
            id: r.data.id,
            title: (r.data.title && (r.data.title.rendered || r.data.title.raw)) || '',
            breakdanceData: meta._breakdance_data || meta.breakdance_data || null,
            link: r.data.link,
            editUrl: (cfg.siteUrl || '').replace(/\/+$/, '') + '/?breakdance=builder&id=' + id,
          });
        } catch (e) {
          return json(res, { error: e.message }, 500);
        }
      }

      // ── Bridge mu-plugin download ───────────────────────────────────
      // The bridge PHP file exposes _elementor_data / _breakdance_data / etc
      // over REST so page-builder writes actually persist. Returns the file
      // contents so the UI can offer a one-click download.
      if (subpath === '/bridge/mu-plugin' && method === 'GET') {
        try {
          const p = path.join(__dirname, 'wp-mu-plugin', 'cadence-bridge.php');
          const content = fs.readFileSync(p, 'utf8');
          res.writeHead(200, {
            'Content-Type': 'application/x-php',
            'Content-Disposition': 'attachment; filename="cadence-bridge.php"',
            'Cache-Control': 'no-store',
          });
          res.end(content);
          return true;
        } catch (e) {
          return json(res, { error: e.message }, 500);
        }
      }

      // Check if the bridge is installed on the target WordPress site.
      // NOTE: The /wp-json/ root is public, so we deliberately send an
      // UNAUTHENTICATED request. Some caching plugins (LiteSpeed, WP Rocket)
      // serve a stripped namespaces list for authenticated requests, which
      // used to cause a false "not installed" when the bridge was actually live.
      if (subpath === '/bridge/status' && method === 'GET') {
        const cfg = cfgRequired(); if (!cfg) return true;
        try {
          const rootUrl = (cfg.siteUrl || '').replace(/\/+$/, '') + '/wp-json/';
          const urlObj = new URL(rootUrl);
          const lib = urlObj.protocol === 'http:' ? http : https;
          const data = await new Promise((resolve, reject) => {
            const req2 = lib.request({
              hostname: urlObj.hostname,
              port: urlObj.port || (urlObj.protocol === 'http:' ? 80 : 443),
              path: urlObj.pathname + urlObj.search,
              method: 'GET',
              headers: {
                'Accept': 'application/json',
                'User-Agent': 'Cadence-Bridge-Check',
                'Cache-Control': 'no-cache',
              },
            }, (resp) => {
              const chunks = [];
              resp.on('data', c => chunks.push(c));
              resp.on('end', () => {
                try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
                catch (e) { reject(e); }
              });
            });
            req2.on('error', reject);
            req2.end();
          });
          const namespaces = (data && data.namespaces) || [];
          const installed = namespaces.some(n => String(n).indexOf('cadence/v1') !== -1);
          return json(res, { installed, namespaces: installed ? ['cadence/v1'] : [] });
        } catch (e) {
          return json(res, { installed: false, error: e.message });
        }
      }

      // ── Site health summary (for future Home dashboard) ─────────────
      if (subpath === '/site/health' && method === 'GET') {
        const cfg = cfgRequired(); if (!cfg) return true;
        const out = { site: {}, counts: {}, plugins: [], issues: [] };
        try {
          const rootR = await wpRequest('GET', (cfg.siteUrl || '').replace(/\/+$/, '') + '/wp-json', cfg);
          if (rootR.data) {
            out.site.name = rootR.data.name || '';
            out.site.description = rootR.data.description || '';
            out.site.url = rootR.data.home || cfg.siteUrl;
            out.site.gmtOffset = rootR.data.gmt_offset;
            out.site.namespaces = (rootR.data.namespaces || []).length;
            out.plugins = detectPluginsFromNamespaces(rootR.data.namespaces || []);
          }
        } catch (_) {}
        const simpleCount = async (rb, extraParams) => {
          try {
            const base = apiBase(cfg) + '/' + rb + '?per_page=1&_fields=id';
            const qs = extraParams != null ? extraParams : 'status=any';
            const r = await wpRequest('GET', qs ? base + '&' + qs : base, cfg);
            return parseInt(r.headers['x-wp-total'] || '0', 10) || 0;
          } catch (_) { return 0; }
        };
        out.counts.posts = await simpleCount('posts');
        out.counts.pages = await simpleCount('pages');
        out.counts.media = await simpleCount('media', '');
        // Drafts = draft posts + draft pages
        const [draftPosts, draftPages] = await Promise.all([
          simpleCount('posts', 'status=draft'),
          simpleCount('pages', 'status=draft')
        ]);
        out.counts.drafts = draftPosts + draftPages;
        try {
          const cmR = await wpRequest('GET', apiBase(cfg) + '/comments?status=hold&per_page=1&_fields=id&context=edit', cfg);
          out.counts.pendingComments = parseInt(cmR.headers['x-wp-total'] || '0', 10) || 0;
          if (out.counts.pendingComments > 0) out.issues.push({ level: 'info', message: out.counts.pendingComments + ' comments awaiting moderation' });
        } catch (_) {}
        // Detect common issues -- paginate through ALL images
        try {
          let noAlt = 0, page = 1, totalPages = 1;
          do {
            const r = await wpRequest('GET',
              apiBase(cfg) + '/media?per_page=100&_fields=id,alt_text&media_type=image&page=' + page, cfg);
            if (page === 1) totalPages = parseInt(r.headers['x-wp-totalpages'] || '1', 10) || 1;
            if (Array.isArray(r.data)) noAlt += r.data.filter(m => !m.alt_text || !m.alt_text.trim()).length;
            page++;
          } while (page <= totalPages);
          if (noAlt > 0) out.issues.push({ level: 'warn', message: noAlt + ' images without alt text (SEO / accessibility)' });
        } catch (_) {}
        return json(res, out);
      }

      // ── Preview proxy ───────────────────────────────────────────────
      // GET /preview?url=<public url>
      // Fetches the live page server-side and returns the HTML with a
      // <base> tag so relative assets resolve. Strips X-Frame-Options and
      // CSP headers so the iframe can render any site.
      if (subpath === '/preview' && method === 'GET') {
        const cfg = cfgRequired(); if (!cfg) return true;
        const target = url.searchParams.get('url');
        if (!target) return json(res, { error: 'url query parameter required' }, 400);
        try {
          // Fetch the public page WITHOUT the WordPress basic-auth header.
          // Sending app-password auth to a public page can make WordPress
          // serve admin bar / logged-in variants that render badly in the
          // iframe and cause theme assets to fall back to mobile layouts.
          const html = await new Promise((resolve, reject) => {
            let urlObj;
            try { urlObj = new URL(target); }
            catch (e) { return reject(new Error('Invalid URL: ' + target)); }
            const lib = urlObj.protocol === 'http:' ? http : https;
            const opts = {
              hostname: urlObj.hostname,
              port: urlObj.port || (urlObj.protocol === 'http:' ? 80 : 443),
              path: urlObj.pathname + urlObj.search,
              method: 'GET',
              headers: {
                'Accept': 'text/html,application/xhtml+xml',
                'Accept-Encoding': 'identity',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
              },
            };
            const rq = lib.request(opts, (resp) => {
              // Follow one level of redirect so /home -> / works
              if ([301, 302, 303, 307, 308].includes(resp.statusCode) && resp.headers.location) {
                const next = new URL(resp.headers.location, target).toString();
                lib.get(next, { headers: opts.headers }, (r2) => {
                  const cks = [];
                  r2.on('data', c => cks.push(c));
                  r2.on('end', () => resolve(Buffer.concat(cks).toString('utf8')));
                }).on('error', reject);
                return;
              }
              const chunks = [];
              resp.on('data', c => chunks.push(c));
              resp.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
            });
            rq.on('error', reject);
            rq.end();
          });
          let out = html || '';
          // Strip CSP meta tags so inline styles / images from the theme
          // do not get blocked inside the iframe.
          out = out.replace(/<meta[^>]+http-equiv=["']?Content-Security-Policy["']?[^>]*>/gi, '');
          // Strip any X-Frame-Options meta (rare, but possible)
          out = out.replace(/<meta[^>]+http-equiv=["']?X-Frame-Options["']?[^>]*>/gi, '');
          // Inject <base> so relative URLs resolve against the real site
          const baseTag = '<base href="' + target.replace(/"/g, '&quot;') + '">';
          if (/<head[^>]*>/i.test(out)) {
            out = out.replace(/<head[^>]*>/i, (m) => m + baseTag);
          } else {
            out = baseTag + out;
          }
          // Rewrite <use href> and <use xlink:href> to go through the
          // same-origin asset proxy below. Cross-origin SVG sprite loading
          // via <use> requires CORS headers on the target, which most
          // WordPress themes do not set, so the symbols render as empty.
          // Routing them through /preview-asset fixes back-to-top arrows,
          // social icons, and similar sprite-based graphics.
          const rewriteUseRef = (attrs) => attrs.replace(
            /(\s(?:xlink:href|href)\s*=\s*)(["'])([^"']+)\2/gi,
            (mm, pre, q, ref) => {
              const trimmed = ref.trim();
              if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('data:')) return mm;
              let absolute;
              try { absolute = new URL(trimmed, target).toString(); }
              catch (_) { return mm; }
              const hashIdx = absolute.indexOf('#');
              const baseUrl = hashIdx >= 0 ? absolute.slice(0, hashIdx) : absolute;
              const frag = hashIdx >= 0 ? absolute.slice(hashIdx) : '';
              const proxied = '/api/plugins/wordpress/preview-asset?url=' + encodeURIComponent(baseUrl) + frag;
              return pre + q + proxied + q;
            }
          );
          out = out.replace(/<use\b([^>]*)>/gi, (tag, attrs) => '<use' + rewriteUseRef(attrs) + '>');
          // Prevent top navigation inside iframe
          const guard = '<style>html,body{margin:0}</style><script>document.addEventListener("click",function(e){var a=e.target.closest&&e.target.closest("a");if(a){e.preventDefault();}},true);</script>';
          if (/<\/head>/i.test(out)) out = out.replace(/<\/head>/i, guard + '</head>');
          res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
            'X-Frame-Options': 'SAMEORIGIN',
          });
          return res.end(out);
        } catch (e) {
          res.writeHead(502, { 'Content-Type': 'text/html; charset=utf-8' });
          return res.end('<html><body style="font:12px sans-serif;color:#888;padding:20px">Preview failed: ' + String(e.message || e).replace(/</g, '&lt;') + '</body></html>');
        }
      }

      // ── Preview asset proxy ─────────────────────────────────────────
      // GET /preview-asset?url=<absolute http(s) url>
      // Same-origin proxy for assets referenced from the preview iframe.
      // Primarily used for SVG sprites loaded via <use href>, which
      // otherwise fail silently cross-origin without CORS headers on the
      // target server. Passes through Content-Type so the browser still
      // treats the response as image/svg+xml, text/css, etc.
      if (subpath === '/preview-asset' && method === 'GET') {
        const cfgAvail = cfgRequired(); if (!cfgAvail) return true;
        const target = url.searchParams.get('url');
        if (!target) return json(res, { error: 'url query parameter required' }, 400);
        let parsed;
        try { parsed = new URL(target); }
        catch (_) { return json(res, { error: 'invalid url' }, 400); }
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          return json(res, { error: 'only http(s) urls allowed' }, 400);
        }
        try {
          const fetchAsset = (u, depth) => new Promise((resolve, reject) => {
            if (depth > 3) return reject(new Error('too many redirects'));
            let po;
            try { po = new URL(u); } catch (e) { return reject(e); }
            const lib = po.protocol === 'http:' ? http : https;
            const opts = {
              hostname: po.hostname,
              port: po.port || (po.protocol === 'http:' ? 80 : 443),
              path: po.pathname + po.search,
              method: 'GET',
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
                'Accept': '*/*',
                'Accept-Encoding': 'identity',
              },
            };
            const rq = lib.request(opts, (resp) => {
              if ([301, 302, 303, 307, 308].includes(resp.statusCode) && resp.headers.location) {
                const next = new URL(resp.headers.location, u).toString();
                resp.resume();
                fetchAsset(next, depth + 1).then(resolve, reject);
                return;
              }
              const chunks = [];
              resp.on('data', c => chunks.push(c));
              resp.on('end', () => resolve({
                statusCode: resp.statusCode || 200,
                headers: resp.headers || {},
                body: Buffer.concat(chunks),
              }));
            });
            rq.on('error', reject);
            rq.end();
          });
          const result = await fetchAsset(target, 0);
          const ctype = result.headers['content-type'] || 'application/octet-stream';
          res.writeHead(result.statusCode, {
            'Content-Type': ctype,
            'Cache-Control': 'public, max-age=300',
            'Access-Control-Allow-Origin': '*',
          });
          return res.end(result.body);
        } catch (e) {
          res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
          return res.end('Asset fetch failed: ' + String(e.message || e));
        }
      }

      // ── Backups ─────────────────────────────────────────────────────
      // POST /backup          body: { restBase, id, reason? }  -> manual snapshot
      // GET  /backups         list all snapshots (newest first)
      // GET  /backups/:type/:id   list snapshots for one item
      // POST /restore/:backupId   restore an item from a snapshot
      // GET  /backup/:id      get raw snapshot JSON
      if (subpath === '/backup' && method === 'POST') {
        const cfg = cfgRequired(); if (!cfg) return true;
        const body = await readBody(req);
        if (!body.restBase || !body.id) return json(res, { error: 'restBase and id required' }, 400);
        try {
          const meta = await createBackup(cfg, body.restBase, body.id, body.reason || 'manual');
          return json(res, { ok: true, backup: meta });
        } catch (e) {
          return json(res, { ok: false, error: e.message }, 500);
        }
      }
      if (subpath === '/backups' && method === 'GET') {
        return json(res, { items: listBackups() });
      }
      const backupsForMatch = subpath.match(/^\/backups\/([a-zA-Z0-9_\-]+)\/(\d+)$/);
      if (backupsForMatch && method === 'GET') {
        const rb = backupsForMatch[1];
        const id = backupsForMatch[2];
        return json(res, { items: listBackups().filter(b => b.restBase === rb && String(b.id) === String(id)) });
      }
      const backupGetMatch = subpath.match(/^\/backup\/([a-zA-Z0-9_\-]+)$/);
      if (backupGetMatch && method === 'GET') {
        const file = path.join(backupsDir, backupGetMatch[1] + '.json');
        if (!fs.existsSync(file)) return json(res, { error: 'Backup not found' }, 404);
        try { return json(res, JSON.parse(fs.readFileSync(file, 'utf8'))); }
        catch (e) { return json(res, { error: e.message }, 500); }
      }
      const restoreMatch = subpath.match(/^\/restore\/([a-zA-Z0-9_\-]+)$/);
      if (restoreMatch && method === 'POST') {
        const cfg = cfgRequired(); if (!cfg) return true;
        if (!(await gate(res, 'POST /api/plugins/wordpress/restore', `Restore WordPress content from backup ${restoreMatch[1]}`))) return;
        const file = path.join(backupsDir, restoreMatch[1] + '.json');
        if (!fs.existsSync(file)) return json(res, { error: 'Backup not found' }, 404);
        try {
          const snap = JSON.parse(fs.readFileSync(file, 'utf8'));
          // Take a safety snapshot of current state before restoring
          try { await createBackup(cfg, snap.restBase, snap.id, 'pre-restore'); } catch (_) {}
          const payload = snap.data || {};
          // Build a restore payload using raw fields when available
          const body = {};
          if (payload.title) body.title = (payload.title.raw != null ? payload.title.raw : payload.title.rendered);
          if (payload.content) body.content = (payload.content.raw != null ? payload.content.raw : payload.content.rendered);
          if (payload.excerpt) body.excerpt = (payload.excerpt.raw != null ? payload.excerpt.raw : payload.excerpt.rendered);
          if (payload.status) body.status = payload.status;
          if (payload.slug) body.slug = payload.slug;
          // Empty meta values ask WordPress to delete the key, which some plugins refuse; leave them out.
          if (payload.meta && typeof payload.meta === 'object') { const m = {}; for (const [k, v] of Object.entries(payload.meta)) if (v !== '' && v !== null && !(Array.isArray(v) && !v.length)) m[k] = v; if (Object.keys(m).length) body.meta = m; }
          if (payload.featured_media !== undefined) body.featured_media = payload.featured_media;
          if (payload.parent !== undefined) body.parent = payload.parent;
          if (payload.menu_order !== undefined) body.menu_order = payload.menu_order;
          if (payload.comment_status) body.comment_status = payload.comment_status;
          if (payload.categories) body.categories = payload.categories;
          if (payload.tags) body.tags = payload.tags;
          let r = await wpRequest('POST', apiBase(cfg) + '/' + snap.restBase + '/' + snap.id, cfg, body);
          let metaSkipped = false;
          // A meta key the site will not take back: restore everything else and say so.
          if (r.status >= 400 && r.data && r.data.code === 'rest_meta_database_error' && body.meta) { delete body.meta; metaSkipped = true; r = await wpRequest('POST', apiBase(cfg) + '/' + snap.restBase + '/' + snap.id, cfg, body); }
          healthCache.clear();
          return json(res, { ok: r.status < 300, status: r.status, metaSkipped, error: r.status >= 300 ? (r.data && r.data.message) || ('HTTP ' + r.status) : undefined, data: r.data });
        } catch (e) {
          return json(res, { ok: false, error: e.message }, 500);
        }
      }

      // ── Site context for AI (theme, plugins, menus, everything) ─────
      if (subpath === '/context/full' && method === 'GET') {
        const cfg = cfgRequired(); if (!cfg) return true;
        const ctx = { site: {}, theme: null, plugins: [], menus: [], namespaces: [], postTypes: [], taxonomies: [] };
        try {
          const rootR = await wpRequest('GET', (cfg.siteUrl || '').replace(/\/+$/, '') + '/wp-json', cfg);
          if (rootR.data) {
            ctx.site = {
              name: rootR.data.name, description: rootR.data.description,
              url: rootR.data.url, home: rootR.data.home,
              gmt_offset: rootR.data.gmt_offset, timezone_string: rootR.data.timezone_string,
              authentication: rootR.data.authentication, site_logo: rootR.data.site_logo,
              site_icon: rootR.data.site_icon,
            };
            ctx.namespaces = rootR.data.namespaces || [];
          }
        } catch (_) {}
        try {
          const typesR = await wpRequest('GET', apiBase(cfg) + '/types?context=edit', cfg);
          if (typesR.data) {
            ctx.postTypes = Object.keys(typesR.data).map(k => ({
              slug: k, label: (typesR.data[k].labels && typesR.data[k].labels.name) || k,
              restBase: typesR.data[k].rest_base,
              hierarchical: !!typesR.data[k].hierarchical,
              viewable: !!typesR.data[k].viewable,
            }));
          }
        } catch (_) {}
        try {
          const taxR = await wpRequest('GET', apiBase(cfg) + '/taxonomies?context=edit', cfg);
          if (taxR.data) {
            ctx.taxonomies = Object.keys(taxR.data).map(k => ({
              slug: k, label: (taxR.data[k].labels && taxR.data[k].labels.name) || k,
              restBase: taxR.data[k].rest_base, types: taxR.data[k].types || [],
            }));
          }
        } catch (_) {}
        // Try /wp/v2/themes
        try {
          const themeR = await wpRequest('GET', apiBase(cfg) + '/themes?status=active', cfg);
          if (Array.isArray(themeR.data) && themeR.data.length) {
            const t = themeR.data[0];
            ctx.theme = {
              stylesheet: t.stylesheet, template: t.template,
              name: (t.name && (t.name.rendered || t.name.raw)) || '',
              version: t.version, textdomain: t.textdomain,
              requires_php: t.requires_php, requires_wp: t.requires_wp,
            };
          }
        } catch (_) {}
        // Try /wp/v2/plugins  (requires capability)
        try {
          const plR = await wpRequest('GET', apiBase(cfg) + '/plugins', cfg);
          if (Array.isArray(plR.data)) {
            ctx.plugins = plR.data.map(p => ({
              plugin: p.plugin, name: p.name, status: p.status,
              version: p.version, author: p.author, textdomain: p.textdomain,
            }));
          }
        } catch (_) {}
        // Menus (if exposed; not in core REST before nav block editor)
        try {
          const menuR = await wpRequest('GET', apiBase(cfg) + '/menus', cfg);
          if (Array.isArray(menuR.data)) ctx.menus = menuR.data;
        } catch (_) {}
        return json(res, ctx);
      }

      // Active theme only
      if (subpath === '/theme' && method === 'GET') {
        const cfg = cfgRequired(); if (!cfg) return true;
        try {
          const r = await wpRequest('GET', apiBase(cfg) + '/themes?status=active', cfg);
          return json(res, Array.isArray(r.data) && r.data.length ? r.data[0] : null, r.status);
        } catch (e) { return json(res, { error: e.message }, 500); }
      }
      // Active plugins list
      if (subpath === '/plugins-list' && method === 'GET') {
        const cfg = cfgRequired(); if (!cfg) return true;
        try {
          const r = await wpRequest('GET', apiBase(cfg) + '/plugins', cfg);
          return json(res, Array.isArray(r.data) ? r.data : [], r.status);
        } catch (e) { return json(res, { error: e.message }, 500); }
      }

      // ── 3.0: the site at a glance (cached a minute) ─────────────────
      if (subpath === '/health' && method === 'GET') {
        const cfg = cfgRequired(); if (!cfg) return true;
        const refresh = url.searchParams.get('refresh') === '1';
        const key = cfg.siteUrl;
        const cached = healthCache.get(key);
        if (!refresh && cached && Date.now() - cached.ts < 60000) return json(res, cached.data);
        const out = { name: cfg.name || '', siteUrl: cfg.siteUrl, adminUrl: (cfg.siteUrl || '').replace(/\/+$/, '') + '/wp-admin/', repoPath: cfg.repoPath || '', site: {}, user: null, types: [], taxonomies: [], plugins: [], counts: { drafts: 0, pending: 0, scheduled: 0, pendingComments: 0, media: 0, imagesNoAlt: 0, users: 0 }, recent: [], issues: [], bridge: null };
        const root = (cfg.siteUrl || '').replace(/\/+$/, '');
        const [rootR, meR, typesR, taxR] = await Promise.all([
          wpRequest('GET', root + '/wp-json', cfg).catch(() => ({ data: null })),
          wpRequest('GET', apiBase(cfg) + '/users/me?context=edit', cfg).catch(() => ({ data: null })),
          wpRequest('GET', apiBase(cfg) + '/types?context=edit', cfg).catch(() => ({ data: null })),
          wpRequest('GET', apiBase(cfg) + '/taxonomies?context=edit', cfg).catch(() => ({ data: null })),
        ]);
        if (rootR.data && typeof rootR.data === 'object') { out.site = { name: rootR.data.name || '', description: rootR.data.description || '', home: rootR.data.home || cfg.siteUrl, timezone: rootR.data.timezone_string || '', gmtOffset: rootR.data.gmt_offset }; out.plugins = detectPluginsFromNamespaces(rootR.data.namespaces || []); out.bridge = (rootR.data.namespaces || []).some((n) => String(n).includes('cadence/v1')); }
        if (meR.data && meR.data.id) out.user = { id: meR.data.id, name: meR.data.name, roles: meR.data.roles || [] };
        const types = [];
        if (typesR.data && typeof typesR.data === 'object') for (const key of Object.keys(typesR.data)) { const t = typesR.data[key]; if (t && t.rest_base) types.push({ slug: key, label: (t.labels && t.labels.name) || t.name || key, restBase: t.rest_base, hierarchical: !!t.hierarchical, viewable: !!t.viewable, internal: INTERNAL_TYPES.has(key) || /^wp_/.test(key), taxonomies: t.taxonomies || [], total: 0, published: 0, drafts: 0, pending: 0, scheduled: 0, private: 0, lastModified: null }); }
        const taxonomies = [];
        if (taxR.data && typeof taxR.data === 'object') for (const key of Object.keys(taxR.data)) { const t = taxR.data[key]; if (t && t.rest_base) taxonomies.push({ slug: key, label: (t.labels && t.labels.name) || t.name || key, restBase: t.rest_base, types: t.types || [], hierarchical: !!t.hierarchical, internal: ['nav_menu', 'link_category', 'post_format', 'wp_pattern_category', 'wp_theme', 'wp_template_part_area'].includes(key), count: 0 }); }
        const count = async (u) => { try { const r = await wpRequest('GET', u, cfg); return parseInt(r.headers['x-wp-total'] || '0', 10) || 0; } catch (_) { return 0; } };
        await Promise.all([
          ...types.map(async (t) => {
            if (t.slug === 'attachment') { t.total = await count(apiBase(cfg) + '/media?per_page=1&_fields=id'); out.counts.media = t.total; return; }
            if (t.internal) { t.total = await count(apiBase(cfg) + '/' + t.restBase + '?per_page=1&_fields=id&context=edit'); return; }
            const [total, drafts, pending, scheduled, priv] = await Promise.all([count(apiBase(cfg) + '/' + t.restBase + '?per_page=1&_fields=id&status=any&context=edit'), count(apiBase(cfg) + '/' + t.restBase + '?per_page=1&_fields=id&status=draft&context=edit'), count(apiBase(cfg) + '/' + t.restBase + '?per_page=1&_fields=id&status=pending&context=edit'), count(apiBase(cfg) + '/' + t.restBase + '?per_page=1&_fields=id&status=future&context=edit'), count(apiBase(cfg) + '/' + t.restBase + '?per_page=1&_fields=id&status=private&context=edit')]);
            t.total = total; t.drafts = drafts; t.pending = pending; t.scheduled = scheduled; t.private = priv; t.published = Math.max(0, total - drafts - pending - scheduled - priv);
          }),
          ...taxonomies.map(async (x) => { x.count = await count(apiBase(cfg) + '/' + x.restBase + '?per_page=1&_fields=id'); }),
          (async () => { out.counts.pendingComments = await count(apiBase(cfg) + '/comments?status=hold&per_page=1&_fields=id&context=edit'); })(),
          (async () => { out.counts.users = await count(apiBase(cfg) + '/users?per_page=1&_fields=id&context=edit'); })(),
        ]);
        // The alt-text scan walks the whole library; insights does it and health reads its cache.
        out.counts.imagesNoAlt = altCache.has(key) ? altCache.get(key).count : null;
        // What changed last, across the content types
        const contentTypes = types.filter((t) => !t.internal && t.slug !== 'attachment' && t.total);
        const recents = await Promise.all(contentTypes.slice(0, 8).map(async (t) => { try { const r = await wpRequest('GET', apiBase(cfg) + '/' + t.restBase + '?per_page=5&status=any&context=edit&orderby=modified&order=desc&_fields=id,type,title,status,slug,link,modified,date,author,featured_media,excerpt,meta', cfg); return Array.isArray(r.data) ? r.data.map((it) => rowOf(it, cfg)) : []; } catch (_) { return []; } }));
        out.recent = recents.flat().sort((a, b) => String(b.modified).localeCompare(String(a.modified))).slice(0, 10);
        for (const t of contentTypes) { out.counts.drafts += t.drafts; out.counts.pending += t.pending; out.counts.scheduled += t.scheduled; const last = out.recent.find((r) => r.type === t.slug); t.lastModified = last ? last.modified : null; }
        out.types = types.sort((a, b) => (a.internal === b.internal ? b.total - a.total : a.internal ? 1 : -1));
        out.taxonomies = taxonomies;
        if (out.counts.drafts) out.issues.push({ level: 'info', issue: 'draft', message: `${out.counts.drafts} draft${out.counts.drafts === 1 ? ' is' : 's are'} waiting.` });
        if (out.counts.pending) out.issues.push({ level: 'warn', issue: 'pending', message: `${out.counts.pending} item${out.counts.pending === 1 ? '' : 's'} pending review.` });
        if (out.counts.pendingComments) out.issues.push({ level: 'warn', issue: 'comments', message: `${out.counts.pendingComments} comment${out.counts.pendingComments === 1 ? '' : 's'} awaiting moderation.` });
        if (out.counts.imagesNoAlt > 0) out.issues.push({ level: 'warn', issue: 'alt', message: `${out.counts.imagesNoAlt} image${out.counts.imagesNoAlt === 1 ? '' : 's'} in the library without alt text.` });
        if (out.plugins.some((p) => p.id === 'elementor' || p.id === 'breakdance') && out.bridge === false) out.issues.push({ level: 'warn', issue: 'bridge', message: 'The Cadence bridge is not installed: page-builder layouts can be read but writes will not persist.' });
        healthCache.set(key, { ts: Date.now(), data: out });
        return json(res, out);
      }

      // ── 3.0: items of a type, one row each ────────────────────────────
      if (subpath === '/entries' && method === 'GET') {
        const cfg = cfgRequired(); if (!cfg) return true;
        const rb = url.searchParams.get('type') || 'pages';
        const sp = new URLSearchParams();
        sp.set('per_page', url.searchParams.get('per_page') || '50');
        sp.set('page', url.searchParams.get('page') || '1');
        sp.set('context', 'edit');
        sp.set('status', url.searchParams.get('status') || 'any');
        sp.set('orderby', url.searchParams.get('orderby') || 'modified');
        sp.set('order', url.searchParams.get('order') || 'desc');
        if (url.searchParams.get('q')) sp.set('search', url.searchParams.get('q'));
        if (url.searchParams.get('parent')) sp.set('parent', url.searchParams.get('parent'));
        for (const k of ['categories', 'tags', 'author']) if (url.searchParams.get(k)) sp.set(k, url.searchParams.get(k));
        sp.set('_fields', 'id,type,title,status,slug,link,modified,date,author,featured_media,parent,menu_order,excerpt,content,meta,yoast_head_json');
        const r = await wpRequest('GET', apiBase(cfg) + '/' + rb + '?' + sp.toString(), cfg);
        if (r.status >= 400) return json(res, { error: (r.data && r.data.message) || ('HTTP ' + r.status), entries: [] }, r.status);
        return json(res, { type: rb, total: parseInt(r.headers['x-wp-total'] || '0', 10) || 0, totalPages: parseInt(r.headers['x-wp-totalpages'] || '1', 10) || 1, entries: (Array.isArray(r.data) ? r.data : []).map((it) => rowOf(it, cfg)) });
      }

      // ── 3.0: one item in full, with everything resolved ───────────────
      if (subpath === '/item' && method === 'GET') {
        const cfg = cfgRequired(); if (!cfg) return true;
        const rb = url.searchParams.get('type') || 'pages';
        const id = url.searchParams.get('id');
        if (!id) return json(res, { error: 'id required' }, 400);
        const r = await wpRequest('GET', apiBase(cfg) + '/' + rb + '/' + id + '?context=edit', cfg);
        if (r.status >= 400 || !r.data || !r.data.id) return json(res, { error: (r.data && r.data.message) || 'Item not found' }, r.status >= 400 ? r.status : 404);
        const it = r.data;
        const row = rowOf(it, cfg);
        const out = { ...row, restBase: rb, content: it.content ? (it.content.raw != null ? it.content.raw : it.content.rendered) : '', rendered: it.content ? it.content.rendered || '' : '', excerptRaw: it.excerpt ? (it.excerpt.raw != null ? it.excerpt.raw : '') : '', template: it.template || '', commentStatus: it.comment_status, sticky: !!it.sticky, format: it.format, password: it.password || '', meta: it.meta || {}, featured: null, authorName: '', terms: {}, elementor: null, backups: [], seo: null, dateGmt: it.date_gmt, modifiedGmt: it.modified_gmt, generatedSlug: it.generated_slug || '' };
        const jobs = [];
        if (it.featured_media) jobs.push(wpRequest('GET', apiBase(cfg) + '/media/' + it.featured_media + '?_fields=id,source_url,alt_text,title,media_details', cfg).then((m) => { if (m.data && m.data.id) out.featured = { id: m.data.id, url: m.data.source_url, alt: m.data.alt_text || '', title: textOf(m.data.title), width: m.data.media_details && m.data.media_details.width, height: m.data.media_details && m.data.media_details.height, thumb: m.data.media_details && m.data.media_details.sizes && m.data.media_details.sizes.medium ? m.data.media_details.sizes.medium.source_url : m.data.source_url }; }).catch(() => {}));
        if (it.author) jobs.push(wpRequest('GET', apiBase(cfg) + '/users/' + it.author + '?_fields=id,name', cfg).then((u) => { if (u.data && u.data.name) out.authorName = u.data.name; }).catch(() => {}));
        // Taxonomy terms: every taxonomy the type declares, resolved to names
        jobs.push(wpRequest('GET', apiBase(cfg) + '/types/' + (it.type || rb) + '?context=edit', cfg).then(async (t) => {
          const taxSlugs = (t.data && t.data.taxonomies) || [];
          if (!taxSlugs.length) return;
          const taxR = await wpRequest('GET', apiBase(cfg) + '/taxonomies?context=edit', cfg);
          for (const slug of taxSlugs) {
            const tax = taxR.data && taxR.data[slug];
            if (!tax || !tax.rest_base) continue;
            const ids = Array.isArray(it[tax.rest_base]) ? it[tax.rest_base] : [];
            const all = await wpRequest('GET', apiBase(cfg) + '/' + tax.rest_base + '?per_page=100&_fields=id,name,slug,parent,count', cfg).catch(() => ({ data: [] }));
            out.terms[tax.rest_base] = { slug, label: (tax.labels && tax.labels.name) || slug, hierarchical: !!tax.hierarchical, selected: ids, options: Array.isArray(all.data) ? all.data.map((x) => ({ id: x.id, name: decodeEntities(x.name), slug: x.slug, parent: x.parent || 0, count: x.count || 0 })) : [] };
          }
        }).catch(() => {}));
        await Promise.all(jobs);
        if (row.builder === 'elementor') { let d = out.meta._elementor_data; if (typeof d === 'string') { try { d = JSON.parse(d); } catch (_) { d = null; } } out.elementor = { version: out.meta._elementor_version || '', template: out.meta._elementor_template_type || '', summary: elementorSummary(d), data: d, editUrl: editUrlFor(cfg, 'elementor', it.id) }; }
        out.backups = listBackups().filter((b) => b.restBase === rb && String(b.id) === String(id)).slice(0, 20);
        const meta = out.meta;
        out.seo = { plugin: meta._yoast_wpseo_title !== undefined || it.yoast_head_json ? 'yoast' : meta.rank_math_title !== undefined ? 'rankmath' : null, title: meta._yoast_wpseo_title || meta.rank_math_title || '', description: meta._yoast_wpseo_metadesc || meta.rank_math_description || '', focusKeyword: meta._yoast_wpseo_focuskw || meta.rank_math_focus_keyword || '', canonical: meta._yoast_wpseo_canonical || meta.rank_math_canonical_url || '', noindex: row.noindex, ogTitle: meta['_yoast_wpseo_opengraph-title'] || meta.rank_math_facebook_title || '', ogDescription: meta['_yoast_wpseo_opengraph-description'] || meta.rank_math_facebook_description || '', rendered: it.yoast_head_json ? { title: it.yoast_head_json.title, description: it.yoast_head_json.description, robots: it.yoast_head_json.robots, ogImage: (it.yoast_head_json.og_image || [])[0] && it.yoast_head_json.og_image[0].url } : null };
        return json(res, out);
      }

      // ── 3.0: insights across the content types ───────────────────────
      if (subpath === '/insights' && method === 'GET') {
        const cfg = cfgRequired(); if (!cfg) return true;
        const typesR = await wpRequest('GET', apiBase(cfg) + '/types?context=edit', cfg);
        const types = [];
        if (typesR.data && typeof typesR.data === 'object') for (const key of Object.keys(typesR.data)) { const t = typesR.data[key]; if (t && t.rest_base && t.viewable && !INTERNAL_TYPES.has(key) && !/^wp_/.test(key) && key !== 'elementor_library') types.push({ slug: key, label: (t.labels && t.labels.name) || key, restBase: t.rest_base }); }
        // Images without alt text, the whole library (up to 1500), remembered for health.
        let imagesNoAlt = 0; let imagesRead = 0; const noAltSample = [];
        try { let page = 1, pages = 1; do { const r = await wpRequest('GET', apiBase(cfg) + '/media?per_page=100&_fields=id,alt_text,title,source_url&media_type=image&page=' + page, cfg); if (page === 1) pages = Math.min(15, parseInt(r.headers['x-wp-totalpages'] || '1', 10) || 1); if (Array.isArray(r.data)) { imagesRead += r.data.length; for (const m of r.data) if (!m.alt_text || !String(m.alt_text).trim()) { imagesNoAlt++; if (noAltSample.length < 50) noAltSample.push({ id: m.id, title: textOf(m.title), url: m.source_url }); } } page++; } while (page <= pages); } catch (_) {}
        altCache.set(cfg.siteUrl, { count: imagesNoAlt, ts: Date.now() });
        const h = healthCache.get(cfg.siteUrl); if (h) { h.data.counts.imagesNoAlt = imagesNoAlt; }
        const staleDays = 180;
        const staleAt = Date.now() - staleDays * 86400000;
        const entries = [];
        const counts = { total: 0, draft: 0, pending: 0, scheduled: 0, private: 0, stale: 0, missingSeoTitle: 0, missingSeoDescription: 0, longSeoTitle: 0, longSeoDescription: 0, noindex: 0, noFeaturedImage: 0, noExcerpt: 0, thin: 0, untitled: 0 };
        for (const t of types) {
          const items = await fetchAllItems(cfg, t.restBase, 'id,type,title,status,slug,link,modified,date,author,featured_media,excerpt,content,meta,yoast_head_json', 500);
          for (const it of items) {
            const row = rowOf(it, cfg);
            const issues = [];
            counts.total++;
            if (row.status === 'draft') { issues.push('draft'); counts.draft++; }
            if (row.status === 'pending') { issues.push('pending'); counts.pending++; }
            if (row.status === 'future') { issues.push('scheduled'); counts.scheduled++; }
            if (row.status === 'private') { issues.push('private'); counts.private++; }
            if (row.status === 'publish' && row.modified && new Date(row.modified).getTime() < staleAt) { issues.push('stale'); counts.stale++; }
            if (row.title === '(no title)') { issues.push('untitled'); counts.untitled++; }
            if (row.status === 'publish' && !row.noindex) {
              if (!row.seoTitle) { issues.push('missing-seo-title'); counts.missingSeoTitle++; } else if (row.seoTitle.length > 60) { issues.push('long-seo-title'); counts.longSeoTitle++; }
              if (!row.seoDescription) { issues.push('missing-seo-description'); counts.missingSeoDescription++; } else if (row.seoDescription.length > 160) { issues.push('long-seo-description'); counts.longSeoDescription++; }
            }
            if (row.noindex && row.status === 'publish') { issues.push('noindex'); counts.noindex++; }
            if (t.slug === 'post' && !row.featuredMedia) { issues.push('no-featured-image'); counts.noFeaturedImage++; }
            if (t.slug === 'post' && !row.excerpt) { issues.push('no-excerpt'); counts.noExcerpt++; }
            if (row.status === 'publish' && !row.builder && row.words < 50 && (t.slug === 'post' || t.slug === 'page')) { issues.push('thin'); counts.thin++; }
            if (issues.length) entries.push({ ...row, restBase: t.restBase, issues });
          }
        }
        counts.imagesNoAlt = imagesNoAlt; counts.imagesRead = imagesRead;
        return json(res, { counts, types, entries: entries.sort((a, b) => b.issues.length - a.issues.length), staleDays, imagesNoAlt: noAltSample });
      }

      // ── 3.0: terms of any taxonomy ─────────────────────────────────────
      const termsListMatch = subpath.match(/^\/terms\/([a-zA-Z0-9_\-]+)$/);
      const termMatch = subpath.match(/^\/terms\/([a-zA-Z0-9_\-]+)\/(\d+)$/);
      if (termsListMatch && method === 'GET') {
        const cfg = cfgRequired(); if (!cfg) return true;
        const sp = new URLSearchParams(); sp.set('per_page', url.searchParams.get('per_page') || '100'); sp.set('context', 'edit'); sp.set('hide_empty', 'false'); if (url.searchParams.get('q')) sp.set('search', url.searchParams.get('q')); if (url.searchParams.get('page')) sp.set('page', url.searchParams.get('page'));
        const r = await wpRequest('GET', apiBase(cfg) + '/' + termsListMatch[1] + '?' + sp.toString(), cfg);
        if (r.status >= 400) return json(res, { error: (r.data && r.data.message) || ('HTTP ' + r.status), terms: [] }, r.status);
        return json(res, { total: parseInt(r.headers['x-wp-total'] || '0', 10) || 0, terms: (Array.isArray(r.data) ? r.data : []).map((x) => ({ id: x.id, name: decodeEntities(x.name), slug: x.slug, description: x.description || '', parent: x.parent || 0, count: x.count || 0, link: x.link, taxonomy: x.taxonomy })) });
      }
      if (termsListMatch && method === 'POST') {
        const cfg = cfgRequired(); if (!cfg) return true;
        const body = await readBody(req);
        const r = await wpRequest('POST', apiBase(cfg) + '/' + termsListMatch[1], cfg, body);
        return json(res, r.data, r.status);
      }
      if (termMatch && (method === 'PUT' || method === 'PATCH')) {
        const cfg = cfgRequired(); if (!cfg) return true;
        const body = await readBody(req);
        const r = await wpRequest('POST', apiBase(cfg) + '/' + termMatch[1] + '/' + termMatch[2], cfg, body);
        return json(res, r.data, r.status);
      }
      if (termMatch && method === 'DELETE') {
        const cfg = cfgRequired(); if (!cfg) return true;
        if (!(await gate(res, 'DELETE /api/plugins/wordpress/terms', `Delete the WordPress term ${termMatch[1]} ${termMatch[2]}`))) return;
        const r = await wpRequest('DELETE', apiBase(cfg) + '/' + termMatch[1] + '/' + termMatch[2] + '?force=true', cfg);
        return json(res, r.data, r.status);
      }

      // ── 3.0: where a media file is used (featured images, then the content) ─
      const mediaUsageMatch = subpath.match(/^\/media\/(\d+)\/usage$/);
      if (mediaUsageMatch && method === 'GET') {
        const cfg = cfgRequired(); if (!cfg) return true;
        const m = await wpRequest('GET', apiBase(cfg) + '/media/' + mediaUsageMatch[1] + '?_fields=id,source_url,media_details', cfg);
        if (!m.data || !m.data.id) return json(res, { items: [] });
        const file = String((m.data.media_details && m.data.media_details.file) || m.data.source_url || '').split('/').pop().replace(/\.[a-z0-9]+$/i, '').replace(/-\d+x\d+$/, '');
        const r = await wpRequest('GET', apiBase(cfg) + '/search?search=' + encodeURIComponent(file) + '&per_page=30', cfg);
        const hits = Array.isArray(r.data) ? r.data : [];
        const featured = [];
        for (const rb of ['pages', 'posts']) { try { const f = await wpRequest('GET', apiBase(cfg) + '/' + rb + '?per_page=100&status=any&context=edit&_fields=id,type,title,status,link,featured_media', cfg); if (Array.isArray(f.data)) featured.push(...f.data.filter((x) => String(x.featured_media) === String(mediaUsageMatch[1])).map((x) => ({ id: x.id, type: x.type, restBase: rb, title: textOf(x.title), status: x.status, link: x.link, how: 'featured image' }))); } catch (_) {} }
        return json(res, { file, items: [...featured, ...hits.filter((h) => !featured.some((f) => f.id === h.id)).map((h) => ({ id: h.id, type: h.subtype, restBase: h.subtype === 'page' ? 'pages' : h.subtype === 'post' ? 'posts' : h.subtype, title: decodeEntities(h.title), link: h.url, how: 'in the content' }))] });
      }

      // ── 3.0: the site: theme, plugins, users, bridge ───────────────────
      if (subpath === '/site' && method === 'GET') {
        const cfg = cfgRequired(); if (!cfg) return true;
        const out = { theme: null, plugins: null, users: [], bridge: null, namespaces: [] };
        const root = (cfg.siteUrl || '').replace(/\/+$/, '');
        await Promise.all([
          wpRequest('GET', apiBase(cfg) + '/themes?status=active', cfg).then((t) => { if (Array.isArray(t.data) && t.data.length) { const x = t.data[0]; out.theme = { name: textOf(x.name), version: x.version, stylesheet: x.stylesheet, template: x.template, author: textOf(x.author), isChild: x.stylesheet !== x.template }; } }).catch(() => {}),
          wpRequest('GET', apiBase(cfg) + '/plugins', cfg).then((p) => { out.plugins = Array.isArray(p.data) ? p.data.map((x) => ({ plugin: x.plugin, name: textOf(x.name), status: x.status, version: x.version, author: textOf(x.author) })) : { error: (p.data && p.data.message) || 'not allowed' }; }).catch(() => {}),
          wpRequest('GET', apiBase(cfg) + '/users?per_page=50&context=edit&_fields=id,name,slug,email,roles,link,registered_date', cfg).then((u) => { if (Array.isArray(u.data)) out.users = u.data.map((x) => ({ id: x.id, name: x.name, slug: x.slug, email: x.email, roles: x.roles || [], link: x.link, registered: x.registered_date })); }).catch(() => {}),
          wpRequest('GET', root + '/wp-json', cfg).then((r) => { out.namespaces = (r.data && r.data.namespaces) || []; out.bridge = out.namespaces.some((n) => String(n).includes('cadence/v1')); }).catch(() => {}),
        ]);
        return json(res, out);
      }

      // ── Raw passthrough (escape hatch for advanced use) ────────────
      // POST /raw  body: { method, path, body, query }
      // path is relative to /wp-json/wp/v2/  OR starts with '/' for absolute /wp-json path
      if (subpath === '/raw' && method === 'POST') {
        const cfg = cfgRequired(); if (!cfg) return true;
        const body = await readBody(req);
        if (!body.path) return json(res, { error: 'path required' }, 400);
        const base = (cfg.siteUrl || '').replace(/\/+$/, '');
        let fullUrl;
        if (body.path.startsWith('/wp-json')) {
          fullUrl = base + body.path;
        } else if (body.path.startsWith('/')) {
          fullUrl = apiBase(cfg) + body.path;
        } else {
          fullUrl = apiBase(cfg) + '/' + body.path;
        }
        if (body.query) {
          const sp = new URLSearchParams(body.query);
          fullUrl += (fullUrl.includes('?') ? '&' : '?') + sp.toString();
        }
        const r = await wpRequest((body.method || 'GET').toUpperCase(), fullUrl, cfg, body.body);
        return json(res, r.data, r.status);
      }

      return false;
    } catch (e) {
      return json(res, { error: e.message, stack: e.stack }, 500);
    }
  });
};
