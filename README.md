# Cadence Plugin: WordPress

WordPress as a screen inside Cadence 3.0, and a center tab in 2.0. Every post type the site has (core, custom, from any plugin), items edited, scheduled, published and previewed, media with alt text, comment moderation, taxonomies, SEO insights, a snapshot before every write, the site's theme, plugins and users, AI review and writing, and one PowerShell script per action so every CLI works the same way.

## The 3.0 surface

- **Overview**: content, what is not live, what to look at, comments waiting; the types, what changed last, what needs attention.
- **Content**: post types as the site declares them (labels in the site's language), a type's items with status filters and paging, and an item as a form: title, slug, content as rich text or HTML (Monaco), excerpt, featured image picked from the library, every taxonomy of the type as chips with inline creation, parent and order, date, comments, SEO title, description and focus keyword with length counters. Save writes it after a snapshot; Publish, Unpublish, For review, Private, Schedule, Trash, Duplicate; a preview of the page; AI review, SEO and "write with AI" per field; page-builder layouts (Elementor and the like) summarised with their text, edited where they live.
- **Media**: grid, upload from a URL, where a file is used, alt text, title and caption, delete when unused.
- **Comments**: approve, hold, spam, trash, reply.
- **Taxonomies**: every taxonomy, terms with counts, add, rename, remove.
- **Insights**: drafts, pending, scheduled, stale, missing or long meta title and description, noindex, thin, no featured image, no excerpt, images without alt text.
- **Backups**: every snapshot, viewable and restorable.
- **Site**: theme, plugins, users, the bridge, the repository.
- **Ask** and **Sites**: a question answered from read-only routes; several sites, each with an application password typed once and never shown again.

Scripts live in `scripts/` (43 of them; see `instructions.md`).

## Installation

### Option 1: Install from local folder (dev)

1. Clone this repo anywhere on disk
2. In Cadence, call the install endpoint with the local path:
   ```bash
   curl -s -X POST http://127.0.0.1:3800/api/plugins/install \
     -H "Content-Type: application/json" \
     -d '{"path":"C:/path/to/cadence-plugin-wordpress"}'
   ```
3. Restart Cadence
4. Open Settings > Plugins > WordPress and enter your credentials

### Option 2: Install from registry (once published)

Use Settings > Plugins > Browse in Cadence and click Install.

## Configuration

You need a WordPress **application password**, not your regular login password.

1. Log in to wp-admin
2. Go to **Users > Profile** (or Users > Your user)
3. Scroll to **Application Passwords**, name it (e.g. "Cadence"), click **Add New Application Password**
4. Copy the generated password (format: `xxxx xxxx xxxx xxxx xxxx xxxx`) -- you only see it once
5. In the Cadence WordPress tab, click the settings gear and enter:
   - **Site URL**: `https://yoursite.com` (no trailing slash)
   - **Username**: your wp-admin login name
   - **Application Password**: the generated password (keep the spaces)
6. Click **Save & test**. The connection dot turns green on success.

To revoke access, delete the application password in wp-admin -- Cadence loses access immediately.

## API Routes

All routes mount under `/api/plugins/wordpress/`. See `instructions.md` for the full list with examples. Highlights:

| Method | Path | Purpose |
|---|---|---|
| GET | `/summary` | Plain-text site overview |
| GET | `/test` | Test connection |
| GET/POST | `/posts` | List / create posts |
| GET/PUT/DELETE | `/posts/:id` | Read / update / trash post |
| GET/POST | `/pages` | List / create pages |
| GET/PUT/DELETE | `/pages/:id` | Read / update / trash page |
| GET/POST | `/media` | List media / (POST not used directly) |
| POST | `/media/upload` | Upload from local file path |
| POST | `/media/upload-url` | Upload from remote URL |
| GET/PUT/DELETE | `/media/:id` | Read / update metadata / delete |
| GET/POST | `/categories`, `/tags` | List / create |
| GET/PUT/DELETE | `/categories/:id`, `/tags/:id` | Read / update / delete |
| GET | `/comments` | List comments |
| POST | `/comments/:id/approve\|hold\|spam\|trash` | Moderate |
| GET | `/users`, `/users/me`, `/users/:id` | Read users |
| GET | `/search?q=...` | Site-wide search |
| GET/PUT | `/seo/posts/:id`, `/seo/pages/:id` | Read / write SEO meta (Yoast + RankMath) |
| GET | `/info`, `/statuses`, `/types` | Site info |
| POST | `/raw` | Raw REST passthrough (escape hatch) |

## Helper Scripts

All scripts run from the plugin's `scripts/` directory once installed.

```bash
# PowerShell
./scripts/Get-WPSummary.ps1
./scripts/New-WPPost.ps1 -Title "My post" -Content "<p>Hello</p>" -Status draft
./scripts/Find-WPContent.ps1 -Query "recipe"
./scripts/Set-WPPostStatus.ps1 -Id 42 -Status publish
./scripts/Update-WPSeo.ps1 -Id 42 -Title "SEO title" -Description "Meta description" -FocusKeyword "recipe"

# Node
node scripts/Upload-WPMedia.js "./image.jpg" --alt "Hero banner" --title "Hero"
```

## Security Notes

- Credentials are stored in `config.json` inside the plugin folder, which is gitignored
- The application password is sent as Basic Auth over HTTPS (the same mechanism used by the official WordPress mobile apps)
- The plugin inherits your user's role, so use an administrator for full control, or a scoped editor account if you want to limit blast radius

## License

MIT
