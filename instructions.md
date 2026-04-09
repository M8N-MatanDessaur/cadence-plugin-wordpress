## WordPress Plugin -- AI Instructions

You have access to a WordPress management plugin that proxies the WordPress REST API (`/wp-json/wp/v2`). This lets you create, read, update, and delete posts, pages, media, categories, tags, comments, users, and SEO metadata (Yoast / RankMath).

**All routes are at** `http://127.0.0.1:3800/api/plugins/wordpress/`

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

### Configuration

```bash
# Check if the plugin is configured
curl -s http://127.0.0.1:3800/api/plugins/wordpress/config

# Save credentials (or have the user do it in the plugin settings UI)
curl -s -X POST http://127.0.0.1:3800/api/plugins/wordpress/config \
  -H "Content-Type: application/json" \
  -d '{"siteUrl":"https://example.com","username":"admin","appPassword":"xxxx xxxx xxxx xxxx xxxx xxxx"}'

# Test connection (returns the logged-in user and roles)
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

### Opening the Dashboard Tab

After any non-trivial action, offer to open the WordPress tab:

```bash
curl -s -X POST http://127.0.0.1:3800/api/ui/view-plugin \
  -H "Content-Type: application/json" \
  -d '{"plugin":"wordpress"}'
```

Ask: "Want me to open the WordPress dashboard?"
