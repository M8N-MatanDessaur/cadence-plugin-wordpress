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

// ── Config helpers ────────────────────────────────────────────────────────
function getCfg() {
  try { return JSON.parse(fs.readFileSync(configPath, 'utf8')); }
  catch (_) { return { siteUrl: '', username: '', appPassword: '' }; }
}
function saveCfg(data) {
  fs.writeFileSync(configPath, JSON.stringify(data, null, 2), 'utf8');
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
      'User-Agent': 'DevOps-Pilot-WordPress-Plugin',
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
module.exports = function ({ addPrefixRoute, json, readBody }) {
  addPrefixRoute(async (req, res, url, subpath) => {
    const method = req.method;
    try {
      // ── Config ─────────────────────────────────────────────────────
      if (subpath === '/config' && method === 'GET') {
        const cfg = getCfg();
        return json(res, {
          configured: isConfigured(cfg),
          siteUrl: cfg.siteUrl || '',
          username: cfg.username || '',
          appPasswordSet: !!cfg.appPassword,
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
      const seoMatch = subpath.match(/^\/seo\/(posts|pages)\/(\d+)$/);
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
              opengraph_title: meta._yoast_wpseo_opengraph_title || '',
              opengraph_description: meta._yoast_wpseo_opengraph_description || '',
              opengraph_image: meta._yoast_wpseo_opengraph_image || '',
              twitter_title: meta._yoast_wpseo_twitter_title || '',
              twitter_description: meta._yoast_wpseo_twitter_description || '',
              twitter_image: meta._yoast_wpseo_twitter_image || '',
              meta_robots_noindex: meta._yoast_wpseo_meta_robots_noindex || '',
              meta_robots_nofollow: meta._yoast_wpseo_meta_robots_nofollow || '',
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
            opengraph_title: '_yoast_wpseo_opengraph_title',
            opengraph_description: '_yoast_wpseo_opengraph_description',
            opengraph_image: '_yoast_wpseo_opengraph_image',
            twitter_title: '_yoast_wpseo_twitter_title',
            twitter_description: '_yoast_wpseo_twitter_description',
            twitter_image: '_yoast_wpseo_twitter_image',
            meta_robots_noindex: '_yoast_wpseo_meta_robots_noindex',
            meta_robots_nofollow: '_yoast_wpseo_meta_robots_nofollow',
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
