## WordPress Plugin -- AI Instructions

You have access to a WordPress management plugin that proxies the WordPress REST API (`/wp-json/wp/v2`). This lets you create, read, update, and delete posts, pages, media, categories, tags, comments, users, and SEO metadata (Yoast / RankMath).

**All routes are at** `http://127.0.0.1:3800/api/plugins/wordpress/`

### Backup-First Rule (CRITICAL)

**You MUST take a backup before any destructive or content-altering action.** The plugin already does this automatically for every PUT / PATCH / DELETE on the `/content/:restBase/:id` route, but when you are about to make bigger changes (rewriting a page, rebuilding a section, running a batch operation), take an explicit manual snapshot first and tell the user what you did.

```bash
# Snapshot a single item before a heavy rewrite
curl -s -X POST http://127.0.0.1:3800/api/plugins/wordpress/backup \
  -H "Content-Type: application/json" \
  -d '{"restBase":"pages","id":12,"reason":"before rewrite"}'

# List all snapshots (newest first)
curl -s http://127.0.0.1:3800/api/plugins/wordpress/backups

# List snapshots for a specific item
curl -s http://127.0.0.1:3800/api/plugins/wordpress/backups/pages/12

# Restore from a snapshot (takes a safety snapshot of current state first)
curl -s -X POST http://127.0.0.1:3800/api/plugins/wordpress/restore/<backupId>
```

Or use the PowerShell wrappers: `Backup-WPItem.ps1`, `Get-WPBackups.ps1`, `Restore-WPItem.ps1`.

If something goes wrong after an edit, always offer to restore from the auto-backup; do not try to "un-edit" by writing another change over the top.

### Dynamic Discovery: Start Here for Any Site

Before editing anything, call `/discover` to learn what the site actually has. This is the ONLY way to know about custom post types (Elementor templates, WooCommerce products, JetPopup popups, FileBird folders, Services, Projects, Teams, Virtual Tours, etc.):

```bash
curl -s http://127.0.0.1:3800/api/plugins/wordpress/discover
```

Returns every registered post type and taxonomy with counts, detected plugin integrations (from REST namespaces), and site identity. The UI sidebar is built directly from this response, so whatever appears there is exactly what you can edit.

For a full human-readable context dump (theme, plugins, menus, namespaces):

```bash
curl -s http://127.0.0.1:3800/api/plugins/wordpress/context/full

# Or via script (plain text, AI-friendly):
powershell.exe -ExecutionPolicy Bypass -NoProfile -File "./scripts/Get-WPSiteContext.ps1"
```

### Generic Content CRUD (works for ANY post type)

Use `/content/:restBase` to list, read, create, update, and delete items of *any* registered post type, taxonomy, or CPT without needing a dedicated endpoint. This is what you want whenever the site has custom types.

```bash
# List items of a custom post type
curl -s "http://127.0.0.1:3800/api/plugins/wordpress/content/product?per_page=20"
curl -s "http://127.0.0.1:3800/api/plugins/wordpress/content/elementor_library?per_page=50"
curl -s "http://127.0.0.1:3800/api/plugins/wordpress/content/services?status=any"

# Get one
curl -s http://127.0.0.1:3800/api/plugins/wordpress/content/product/448

# Create
curl -s -X POST http://127.0.0.1:3800/api/plugins/wordpress/content/services \
  -H "Content-Type: application/json" \
  -d '{"title":"New service","content":"<p>...</p>","status":"draft"}'

# Update (auto-backup is taken BEFORE the write)
curl -s -X PUT http://127.0.0.1:3800/api/plugins/wordpress/content/pages/12 \
  -H "Content-Type: application/json" \
  -d '{"content":"<p>Updated body</p>"}'

# Delete (auto-backup is taken BEFORE the delete)
curl -s -X DELETE http://127.0.0.1:3800/api/plugins/wordpress/content/product/448
```

The `restBase` values come from `/discover` -- it is usually the plural form of the slug (`posts`, `pages`, `product`, `elementor_library`). Do NOT guess; read `/discover` first.

### IMPORTANT: Start with the Summary

Always fetch the summary first before making changes. It is plain text, no JSON parsing needed, and gives you counts and recent activity:

```bash
curl -s http://127.0.0.1:3800/api/plugins/wordpress/summary
```

Sample output:
```
WordPress Site Summary
======================

Site: https://example.com
Logged in as: Admin (administrator)

Content counts:
  Posts:      124
  Pages:      18
  Media:      842
  Comments:   56
  Categories: 9
  Tags:       41
  Users:      3

Recent posts (10):
  [publish] Hello world  (id:1, modified:2026-04-08)
  ...
```

### Guardrails -- ASK THE USER FIRST

You **must ask for explicit confirmation** before any of these actions:

- Publishing a post or page (moving from `draft` to `publish`)
- Deleting any post, page, media item, category, tag, comment, or user
- Updating a published post or page (the change goes live immediately)
- Uploading media (even though safe, the user may not want the file on the server)
- Approving, spamming, or trashing comments
- Mutating SEO fields on published content

You **do not** need to ask for:
- Reading anything (summary, lists, details, search)
- Creating drafts (status `draft`) that the user can review before publishing
- Saving notes about WordPress content into DevOps Pilot notes

### Configuration (Multi-Site)

The plugin supports multiple WordPress sites. All API operations use the currently active site.

```bash
# List all configured sites and see which one is active
curl -s http://127.0.0.1:3800/api/plugins/wordpress/sites

# Add a new site
curl -s -X POST http://127.0.0.1:3800/api/plugins/wordpress/sites \
  -H "Content-Type: application/json" \
  -d '{"name":"My Blog","siteUrl":"https://example.com","username":"admin","appPassword":"xxxx xxxx xxxx xxxx xxxx xxxx"}'

# Switch the active site
curl -s -X POST http://127.0.0.1:3800/api/plugins/wordpress/sites/active \
  -H "Content-Type: application/json" \
  -d '{"name":"My Blog"}'

# Update a site (only changed fields required; omit appPassword to keep existing)
curl -s -X PUT http://127.0.0.1:3800/api/plugins/wordpress/sites/My%20Blog \
  -H "Content-Type: application/json" \
  -d '{"siteUrl":"https://newurl.com"}'

# Remove a site
curl -s -X DELETE http://127.0.0.1:3800/api/plugins/wordpress/sites/My%20Blog

# Check the active site config status
curl -s http://127.0.0.1:3800/api/plugins/wordpress/config

# Test connection (returns the logged-in user and roles for the active site)
curl -s http://127.0.0.1:3800/api/plugins/wordpress/test
```

### Posts

```bash
# List posts (default: any status, 20 per page, newest first)
curl -s "http://127.0.0.1:3800/api/plugins/wordpress/posts"

# Filter by status / category / author / search
curl -s "http://127.0.0.1:3800/api/plugins/wordpress/posts?status=draft&per_page=50"
curl -s "http://127.0.0.1:3800/api/plugins/wordpress/posts?categories=5&per_page=20"
curl -s "http://127.0.0.1:3800/api/plugins/wordpress/posts?search=recipe"

# Get one post (full content, meta, all fields)
curl -s http://127.0.0.1:3800/api/plugins/wordpress/posts/42

# Create a DRAFT (no confirmation needed)
curl -s -X POST http://127.0.0.1:3800/api/plugins/wordpress/posts \
  -H "Content-Type: application/json" \
  -d '{
    "title":"My draft",
    "content":"<p>Hello world</p>",
    "status":"draft",
    "excerpt":"Short summary",
    "categories":[5],
    "tags":[12,14],
    "featured_media":789,
    "slug":"my-draft"
  }'

# Publish (ASK FIRST)
curl -s -X PUT http://127.0.0.1:3800/api/plugins/wordpress/posts/42 \
  -H "Content-Type: application/json" \
  -d '{"status":"publish"}'

# Update content (ASK FIRST if already published)
curl -s -X PUT http://127.0.0.1:3800/api/plugins/wordpress/posts/42 \
  -H "Content-Type: application/json" \
  -d '{"title":"New title","content":"<p>New body</p>"}'

# Move to trash (ASK FIRST)
curl -s -X DELETE http://127.0.0.1:3800/api/plugins/wordpress/posts/42

# Permanently delete (ASK FIRST, very destructive)
curl -s -X DELETE "http://127.0.0.1:3800/api/plugins/wordpress/posts/42?force=true"
```

**Post fields:** `title`, `content` (HTML or Gutenberg blocks), `excerpt`, `status` (draft/publish/pending/future/private), `date` (ISO for scheduling), `slug`, `categories` (array of IDs), `tags` (array of IDs), `featured_media` (media ID), `author` (user ID), `sticky`, `format`, `comment_status` (open/closed), `meta` (custom meta)

### Pages

Same shape as posts, replacing `/posts` with `/pages`:

```bash
curl -s "http://127.0.0.1:3800/api/plugins/wordpress/pages?status=any"
curl -s http://127.0.0.1:3800/api/plugins/wordpress/pages/2
curl -s -X POST http://127.0.0.1:3800/api/plugins/wordpress/pages \
  -H "Content-Type: application/json" \
  -d '{"title":"New page","content":"<p>...</p>","status":"draft","parent":0,"menu_order":5}'
```

Pages also support `parent` (page ID for hierarchy) and `menu_order`.

### Media

```bash
# List media (grid data with thumbnails + source_url)
curl -s "http://127.0.0.1:3800/api/plugins/wordpress/media?per_page=24"

# Filter by mime type / parent post / search
curl -s "http://127.0.0.1:3800/api/plugins/wordpress/media?media_type=image&search=hero"

# Get one media item
curl -s http://127.0.0.1:3800/api/plugins/wordpress/media/789

# Upload from a LOCAL file path (absolute path on this machine)
curl -s -X POST http://127.0.0.1:3800/api/plugins/wordpress/media/upload \
  -H "Content-Type: application/json" \
  -d '{
    "filePath":"C:/path/to/image.jpg",
    "filename":"hero-banner.jpg",
    "alt_text":"Hero banner showing mountain",
    "caption":"<p>Captured at sunrise</p>",
    "title":"Hero Banner"
  }'

# Upload from a REMOTE URL (the server downloads then uploads)
curl -s -X POST http://127.0.0.1:3800/api/plugins/wordpress/media/upload-url \
  -H "Content-Type: application/json" \
  -d '{"url":"https://images.example.com/photo.jpg","alt_text":"Alt text"}'

# Update metadata (alt text, caption, description) -- ASK FIRST
curl -s -X PUT http://127.0.0.1:3800/api/plugins/wordpress/media/789 \
  -H "Content-Type: application/json" \
  -d '{"alt_text":"Updated alt text","caption":"<p>Updated caption</p>"}'

# Delete (ASK FIRST, always permanent)
curl -s -X DELETE http://127.0.0.1:3800/api/plugins/wordpress/media/789
```

### Categories and Tags

```bash
# List (returns up to 100 per page by default)
curl -s http://127.0.0.1:3800/api/plugins/wordpress/categories
curl -s http://127.0.0.1:3800/api/plugins/wordpress/tags

# Create
curl -s -X POST http://127.0.0.1:3800/api/plugins/wordpress/categories \
  -H "Content-Type: application/json" \
  -d '{"name":"Recipes","slug":"recipes","description":"All recipes","parent":0}'

# Update / Delete -- ASK FIRST
curl -s -X PUT http://127.0.0.1:3800/api/plugins/wordpress/categories/5 \
  -H "Content-Type: application/json" \
  -d '{"name":"Updated name"}'
curl -s -X DELETE http://127.0.0.1:3800/api/plugins/wordpress/categories/5
```

### Comments (Moderation)

```bash
# List all comments
curl -s "http://127.0.0.1:3800/api/plugins/wordpress/comments?status=hold"
curl -s "http://127.0.0.1:3800/api/plugins/wordpress/comments?post=42"

# Get one comment
curl -s http://127.0.0.1:3800/api/plugins/wordpress/comments/123

# Reply (ASK FIRST, this posts publicly)
curl -s -X POST http://127.0.0.1:3800/api/plugins/wordpress/comments \
  -H "Content-Type: application/json" \
  -d '{"post":42,"parent":123,"content":"Thanks for the feedback!"}'

# Approve / Hold / Spam / Trash (ASK FIRST, shortcut routes)
curl -s -X POST http://127.0.0.1:3800/api/plugins/wordpress/comments/123/approve
curl -s -X POST http://127.0.0.1:3800/api/plugins/wordpress/comments/123/hold
curl -s -X POST http://127.0.0.1:3800/api/plugins/wordpress/comments/123/spam
curl -s -X POST http://127.0.0.1:3800/api/plugins/wordpress/comments/123/trash

# Permanently delete
curl -s -X DELETE "http://127.0.0.1:3800/api/plugins/wordpress/comments/123?force=true"
```

### Users

```bash
# List users
curl -s http://127.0.0.1:3800/api/plugins/wordpress/users

# Current user
curl -s http://127.0.0.1:3800/api/plugins/wordpress/users/me

# One user
curl -s http://127.0.0.1:3800/api/plugins/wordpress/users/3
```

User write operations are intentionally not exposed. To add or edit users, ask the user to do it in wp-admin.

### Search

```bash
# Cross-type search (posts + pages + media)
curl -s "http://127.0.0.1:3800/api/plugins/wordpress/search?q=mountain"

# Scope by type
curl -s "http://127.0.0.1:3800/api/plugins/wordpress/search?q=recipe&type=post"
```

### SEO (Yoast / RankMath)

The plugin reads and writes the standard meta fields used by both Yoast SEO and RankMath. If the site uses one, use the matching block; if you do not know, you can set both and unused fields are simply ignored.

```bash
# Read SEO fields for a post or page
curl -s http://127.0.0.1:3800/api/plugins/wordpress/seo/posts/42
curl -s http://127.0.0.1:3800/api/plugins/wordpress/seo/pages/2
```

Returns structured Yoast, RankMath, and the rendered `<head>` JSON if Yoast is active.

```bash
# Update SEO fields (ASK FIRST if published)
curl -s -X PUT http://127.0.0.1:3800/api/plugins/wordpress/seo/posts/42 \
  -H "Content-Type: application/json" \
  -d '{
    "yoast": {
      "title": "Best Mountain Recipes | Example",
      "metadesc": "Discover 12 easy mountain recipes perfect for weekend cooking.",
      "focuskw": "mountain recipes",
      "opengraph_title": "Best Mountain Recipes",
      "opengraph_description": "12 easy recipes"
    },
    "rankmath": {
      "title": "Best Mountain Recipes | Example",
      "description": "Discover 12 easy mountain recipes perfect for weekend cooking.",
      "focus_keyword": "mountain recipes"
    }
  }'
```

**SEO best practices when you write for the user:**
- SEO title: 50 to 60 characters, includes the focus keyword near the start
- Meta description: 140 to 160 characters, includes focus keyword, has a call to action
- Focus keyword: one phrase, 1 to 4 words, the thing people actually search
- OG title and description can be slightly different from SEO title, more emotional
- Do not stuff keywords; write for humans first

### Site Info, Statuses, Post Types

```bash
# Site info (name, description, URL, timezone, installed namespaces)
curl -s http://127.0.0.1:3800/api/plugins/wordpress/info

# Post statuses (publish, draft, pending, future, private, trash)
curl -s http://127.0.0.1:3800/api/plugins/wordpress/statuses

# Registered post types (including custom post types)
curl -s http://127.0.0.1:3800/api/plugins/wordpress/types
```

### Raw Passthrough (Escape Hatch)

For anything not explicitly wrapped (custom post types, REST namespaces from other plugins, etc.), use `/raw`:

```bash
curl -s -X POST http://127.0.0.1:3800/api/plugins/wordpress/raw \
  -H "Content-Type: application/json" \
  -d '{
    "method":"GET",
    "path":"/wp-json/wc/v3/products",
    "query":{"per_page":"10"}
  }'
```

`path` can be:
- `/wp-json/...` for an absolute REST route (e.g. WooCommerce `/wp-json/wc/v3/products`)
- `/something` resolved relative to `/wp-json/wp/v2/`
- `something` same as above

### Content Authoring Workflow

When the user asks you to write a post or page:

1. Fetch the summary to understand the site voice and existing content counts.
2. Ask clarifying questions only if you do not have enough to write well: topic, target audience, length, tone, category/tag, focus keyword.
3. Write the post as a DRAFT (`status: "draft"`) without asking.
4. Include semantic HTML: `<h2>`, `<h3>`, `<p>`, `<ul>`, `<blockquote>`, `<img>`. WordPress will render this in Gutenberg as classic blocks.
5. Propose SEO metadata (title, description, focus keyword) as a draft as well.
6. Show the user a summary (title, first paragraph, link to the draft in wp-admin) and ask if they want you to publish.

### Image Workflow

When adding images to a post:

1. If the user provides a local path, upload with `/media/upload`.
2. If the user provides a URL, upload with `/media/upload-url`.
3. Set `alt_text` on upload (accessibility, SEO).
4. Use the returned `id` as the post's `featured_media`, and/or embed `<img src="source_url" alt="...">` in the post content.

### Pre-made Scripts (prefer these from bash or PowerShell)

| Script | Purpose |
|--------|---------|
| `Get-WPSummary.ps1` | Quick counts and recent activity |
| `Get-WPSiteContext.ps1` | Full context dump for the AI (theme, plugins, CPTs, taxonomies, menus, namespaces) |
| `Get-WPSiteHealth.ps1` | Site health: counts, detected plugins, issues list (missing alt text, pending comments) |
| `Find-WPContent.ps1` | Search posts/pages/media by keyword |
| `New-WPPost.ps1` | Create a draft post |
| `Set-WPPostStatus.ps1` | Change status (draft, publish, trash, etc.) |
| `Update-WPSeo.ps1` | Update Yoast/RankMath SEO meta |
| `Upload-WPMedia.js` | Upload a local file to the media library |
| `Backup-WPItem.ps1` | Manual snapshot of any item (post/page/CPT) |
| `Restore-WPItem.ps1` | Restore an item from a snapshot |
| `Get-WPBackups.ps1` | List saved snapshots (optionally filter by item) |
| `Get-WPElementorTemplates.ps1` | List all Elementor library templates (pages, sections, headers, footers, popups) |
| `Get-WPElementorPage.ps1` | Fetch _elementor_data for a page and summarise the widget tree (or -Full for raw JSON) |
| `Copy-WPElementorPage.ps1` | Clone an Elementor page or template into a new draft -- use this to build pages from references |
| `Get-WPBreakdanceTemplates.ps1` | List all Breakdance templates, headers, footers, popups, and blocks |
| `Install-WPBridge.ps1` | Download the devops-pilot-bridge.php mu-plugin (needed for page-builder REST writes) |
| `Test-WPBridge.ps1` | Check whether the bridge mu-plugin is installed on the target site |

From bash, run PowerShell scripts with:

```bash
powershell.exe -ExecutionPolicy Bypass -NoProfile -File "./scripts/Get-WPSiteContext.ps1"
powershell.exe -ExecutionPolicy Bypass -NoProfile -Command "./scripts/Backup-WPItem.ps1 -RestBase pages -Id 12 -Reason 'before rewrite'"
```

### Preview Proxy

The UI renders a live preview of a post or page inside an iframe via `/preview?url=<url>`. The plugin fetches the page server-side, injects a `<base>` tag so relative assets resolve, and strips `X-Frame-Options` / CSP so any site can be framed. You do not normally call this endpoint directly, but it is available if you want to render a preview elsewhere.

```bash
curl -s "http://127.0.0.1:3800/api/plugins/wordpress/preview?url=https://example.com/page-slug"
```

### Opening the Dashboard Tab

After any non-trivial action, offer to open the WordPress tab:

```bash
curl -s -X POST http://127.0.0.1:3800/api/ui/view-plugin \
  -H "Content-Type: application/json" \
  -d '{"plugin":"wordpress"}'
```

Ask: "Want me to open the WordPress dashboard?"

---

## Page Builders

Most modern WordPress sites do NOT store their layout in `post_content` as HTML. They store it in page-builder-specific meta fields. You MUST detect the builder first and use its data format.

### Detecting the active builder

1. Call `/discover` -- the `plugins` array lists builders detected from REST namespaces (`elementor`, `breakdance`, `oxygen`, `bricks`, `beaver`, `divi`).
2. For per-item detection, fetch the item with `?context=edit` and inspect `meta`:
   - `meta._elementor_edit_mode === 'builder'` or non-empty `meta._elementor_data` -> Elementor
   - `meta._breakdance_data` or `meta.breakdance_data` -> Breakdance
   - `meta._et_pb_use_builder === 'on'` -> Divi
   - `meta._fl_builder_enabled === '1'` -> Beaver Builder
   - `meta.bricks_page_content_2` -> Bricks
   - `meta.ct_builder_shortcodes` -> Oxygen
3. If none of those match, `post_content` is the source of truth (Gutenberg blocks or classic editor) and you can edit it via the standard `/content/:restBase/:id` route.

### Elementor

**Edit URL in the browser:** `{siteUrl}/wp-admin/post.php?post={id}&action=elementor`

**Data structure:** Elementor stores the full layout as a JSON string in post meta `_elementor_data`. The top level is an array of sections (or containers in the modern flexbox engine). Each section has `elements` -> columns -> `elements` -> widgets. Every node has:
- `id` -- random hex string, unique per document
- `elType` -- `section`, `column`, `container`, or `widget`
- `widgetType` -- only for widgets: `heading`, `text-editor`, `image`, `button`, `spacer`, `divider`, `icon`, `google_maps`, plus any registered pro/3rd-party widget
- `settings` -- key/value of control values (text, colors, spacing, etc.). Control names match the Elementor editor panel labels.
- `elements` -- child nodes

**Related meta fields:**
- `_elementor_edit_mode` -- `builder` when Elementor is active on that post
- `_elementor_version` -- the Elementor version that last saved the layout
- `_elementor_template_type` -- `wp-page`, `wp-post`, `page`, `section`, `header`, `footer`, `popup`, `widget` (for library items)
- `_elementor_css` -- generated CSS cache (readonly for our purposes)

**Plugin endpoints:**

```bash
# List all Elementor library templates (pages, sections, headers, footers, popups)
curl -s http://127.0.0.1:3800/api/plugins/wordpress/elementor/templates

# Read the raw Elementor JSON for a page
curl -s "http://127.0.0.1:3800/api/plugins/wordpress/elementor/page/123?type=pages"

# Clone a template or existing page onto a new draft
curl -s -X POST http://127.0.0.1:3800/api/plugins/wordpress/elementor/clone \
  -H "Content-Type: application/json" \
  -d '{"sourceId":123,"sourceType":"pages","targetType":"pages","title":"Homepage -- Montreal"}'
```

**Writing `_elementor_data`:** WordPress does NOT expose `_elementor_data` via REST by default. If `PUT /elementor/page/:id` returns 200 but the editor does not reflect the change, the site needs a tiny must-use plugin that registers the meta with `show_in_rest => true`:

```php
// wp-content/mu-plugins/devops-pilot-elementor-bridge.php
add_action('init', function () {
  $types = ['post', 'page'];
  $meta_keys = ['_elementor_data', '_elementor_edit_mode', '_elementor_version', '_elementor_template_type'];
  foreach ($types as $t) {
    foreach ($meta_keys as $k) {
      register_post_meta($t, $k, [
        'show_in_rest' => true,
        'single' => true,
        'type' => 'string',
        'auth_callback' => function () { return current_user_can('edit_posts'); },
      ]);
    }
  }
});
```

After that file is dropped in, Elementor writes via REST are reliable. For sites where you cannot install a mu-plugin, use WP-CLI over SSH instead (`wp post meta update <id> _elementor_data '<json>'`) or the Elementor REST import endpoints on newer versions.

**Building new Elementor pages:** Do NOT try to hand-write `_elementor_data` from scratch. Always clone a known-good template (via `/elementor/clone`) then walk the JSON and replace strings/images. Ask the user which template to start from. The `/elementor/templates` endpoint lists every saved template on the site.

**Debugging an Elementor page:**
1. `GET /elementor/page/:id` -- returns parsed JSON
2. Walk the tree, collect: widgets with empty settings, broken image URLs (404), links pointing to dev hosts, missing responsive settings, deprecated widgets
3. Report findings BEFORE writing anything
4. If the user approves, write only the specific changed nodes back

### Breakdance

**Edit URL in the browser:** `{siteUrl}/?breakdance=builder&id={id}` (confirm against the site; some installs expose it as a wp-admin page instead).

**Data structure:** Breakdance stores layout in post meta `_breakdance_data` as JSON. The structure is similar to Elementor (nested element tree) but with different type names and property layout. Read-only access is supported out of the box; writing requires the same meta-registration trick as Elementor (Breakdance does not expose its meta in REST by default).

**WP-CLI:** Breakdance 2.7+ ships `wp breakdance` commands for cache clearing, URL replacement, settings import/export, license, system status, directory management, soft/total resets, and i18n POT generation. These run server-side via SSH -- not through REST. When working on a site with SSH access, prefer `wp breakdance` for infrastructure tasks and the REST API (plus our mu-plugin bridge) for content edits.

**Plugin endpoints:**

```bash
# List all Breakdance templates/headers/footers/popups/blocks
curl -s http://127.0.0.1:3800/api/plugins/wordpress/breakdance/templates

# Read Breakdance data for a specific page
curl -s "http://127.0.0.1:3800/api/plugins/wordpress/breakdance/page/123?type=pages"
```

### Other builders

- **Divi** -- `_et_pb_use_builder = on`, layout shortcodes inside `post_content`. Editing means rewriting shortcodes. Use the normal `/content` endpoint, not a builder endpoint.
- **Beaver Builder** -- `_fl_builder_enabled = 1`, layout in serialized PHP in `_fl_builder_data_settings`. Editing requires WP-CLI or a custom mu-plugin to unserialize.
- **Bricks** -- `bricks_page_content_2` / `bricks_page_header_2` / `bricks_page_footer_2`, JSON arrays. Similar mu-plugin bridge pattern.
- **Oxygen** -- `ct_builder_shortcodes`, shortcodes, edited via Oxygen's own edit link.

For any unlisted builder, `/context/full` will surface the active plugins; ask the user how their site stores layout if it is not obvious.

### Universal workflow for "build me a page like the homepage but for X"

1. Fetch the user's site context so you know which builder is active.
2. List templates from that builder (`/elementor/templates`, `/breakdance/templates`, or fall back to posts/pages if the site uses Gutenberg).
3. Ask which template or page is the reference.
4. Clone it to a new draft via `/elementor/clone` (or the equivalent).
5. Open the new page in the dashboard so the user can confirm.
6. Iterate on specific fields (hero title, images, button links) via small targeted edits rather than rewriting the whole layout.
7. Snapshot before each write. Offer to revert if the user does not like a change.

### Site Health Summary

For a quick site overview without loading every individual item:

```bash
curl -s http://127.0.0.1:3800/api/plugins/wordpress/site/health
```

Returns: site name/url, counts (posts, pages, media, drafts, pending comments), detected plugins, and issues (missing alt text, pending comments, etc.). Useful for the home dashboard or for giving the user a "status check" on their site.

### The Bridge Mu-Plugin

The DevOps Pilot plugin ships a companion must-use plugin at `wp-mu-plugin/devops-pilot-bridge.php`. It is the fix for the "REST returns 200 but nothing updated" problem on page-builder sites.

**What it does:**
- Registers page-builder meta keys (`_elementor_data`, `_breakdance_data`, `bricks_page_content_2`, `_fl_builder_data`, `_et_pb_use_builder`, plus all their siblings) on every public post type with `show_in_rest => true` and an `edit_post` auth callback. This is the ONLY way to read/write these fields over REST.
- Adds `/wp-json/devops-pilot/v1/builder-info/{id}` which returns which builder a post is using, its version, data length, and an MD5 hash. Use this as a fast per-item detection that does not require pulling the full post.
- Adds `/wp-json/devops-pilot/v1/elementor/clear-cache/{id}` which deletes `_elementor_css` and calls Elementor's file cache manager. You MUST call this after writing `_elementor_data` or the front end will keep rendering the old layout.

**Detecting and installing it:**

```bash
# From bash, check if the bridge is installed on the current site:
curl -s http://127.0.0.1:3800/api/plugins/wordpress/bridge/status
# -> { "installed": true }  or  { "installed": false }

# Download the file to the current directory (user then uploads to the site):
curl -s http://127.0.0.1:3800/api/plugins/wordpress/bridge/mu-plugin -o devops-pilot-bridge.php

# Or via PowerShell wrapper:
powershell.exe -ExecutionPolicy Bypass -NoProfile -File "./scripts/Install-WPBridge.ps1"
powershell.exe -ExecutionPolicy Bypass -NoProfile -File "./scripts/Test-WPBridge.ps1"
```

**Where to put it:** `wp-content/mu-plugins/devops-pilot-bridge.php` on the target WordPress site. Create the directory if it does not exist. mu-plugins load automatically on every request -- no activation, no admin UI, cannot be turned off by site admins. This is intentional; it is a low-level bridge and should be invisible.

**When to ask the user to install it:**
- They asked you to edit a page built with Elementor/Breakdance/Bricks/Beaver/Divi and the write returned 200 with no change on the site
- They ran `Test-WPBridge.ps1` and it reported "not installed"
- You are about to clone or modify a page-builder layout for the first time on a new site

**When NOT to mention it:**
- The site uses classic editor or Gutenberg only -- the bridge is not needed for `post_content`.
- You are only READING data with `context=edit` as an authenticated user -- reads already work for most meta fields.

After installation, ALWAYS clear the Elementor CSS cache after any `_elementor_data` write, otherwise the front end will keep rendering the old layout. Call the bridge namespace directly using the application password you already have configured:

```bash
curl -s -X POST -u "$WP_USER:$WP_APP_PASSWORD" \
  https://site.com/wp-json/devops-pilot/v1/elementor/clear-cache/123
```
