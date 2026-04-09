#!/usr/bin/env node
/**
 * Upload a local file to the WordPress media library via the plugin API.
 *
 * Usage:
 *   node Upload-WPMedia.js <filePath> [--alt "alt text"] [--title "Title"]
 *                          [--caption "Caption"] [--post 42]
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
  console.log('Usage: node Upload-WPMedia.js <filePath> [--alt "..."] [--title "..."] [--caption "..."] [--post <id>]');
  process.exit(0);
}

const filePath = path.resolve(args[0]);
if (!fs.existsSync(filePath)) {
  console.error('File not found: ' + filePath);
  process.exit(1);
}

// Parse optional flags
function flag(name) {
  const idx = args.indexOf('--' + name);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

const body = {
  filePath,
  filename: path.basename(filePath),
  alt_text: flag('alt'),
  title: flag('title'),
  caption: flag('caption'),
  post: flag('post') ? parseInt(flag('post'), 10) : undefined,
};
// Strip undefined fields
Object.keys(body).forEach(k => body[k] === undefined && delete body[k]);

const payload = JSON.stringify(body);

const req = http.request({
  hostname: '127.0.0.1',
  port: 3800,
  path: '/api/plugins/wordpress/media/upload',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  },
}, (res) => {
  const chunks = [];
  res.on('data', c => chunks.push(c));
  res.on('end', () => {
    const text = Buffer.concat(chunks).toString('utf8');
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    if (res.statusCode >= 400 || (data && data.error)) {
      console.error('Upload failed:', data);
      process.exit(1);
    }
    console.log('Uploaded media #' + data.id);
    console.log('  Title:      ' + (data.title && data.title.rendered));
    console.log('  Source URL: ' + data.source_url);
    console.log('  Alt text:   ' + (data.alt_text || ''));
  });
});
req.on('error', e => { console.error('Request failed:', e.message); process.exit(1); });
req.write(payload);
req.end();
