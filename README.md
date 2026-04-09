# WordPress Plugin for DevOps Pilot

Manage WordPress sites end-to-end from DevOps Pilot. Posts, pages, media, categories, tags, comments, users, SEO metadata (Yoast / RankMath), and a raw REST passthrough for anything else (WooCommerce, ACF, custom post types).

## Features

- **Content CRUD** for posts and pages, including draft workflow, scheduling, and Gutenberg-compatible HTML
- **Media library** with local file upload, remote URL upload, alt-text / caption / description editing, grid browser
- **Categories and Tags** full CRUD, with parent hierarchy for categories
- **Comment moderation** (approve / hold / spam / trash / reply / delete)
- **Users** browser (read-only for safety)
- **SEO panel** that reads and writes Yoast SEO _and_ RankMath meta fields in one shot, so it works regardless of which plugin is installed
- **Site-wide search** across posts, pages, and media
- **Plain-text summary** endpoint tuned for AI consumption
- **Raw passthrough** for any `/wp-json/...` route (WooCommerce, ACF, custom post types, anything)
- **Responsive dashboard UI** that adapts to screens from phone to widescreen
- **PowerShell + Node helper scripts** for common tasks

## Installation

### Option 1: Install from local folder (dev)

1. Clone this repo anywhere on disk
2. In DevOps Pilot, call the install endpoint with the local path:
   ```bash
   curl -s -X POST http://127.0.0.1:3800/api/plugins/install \
     -H "Content-Type: application/json" \
     -d '{"path":"C:/path/to/devops-pilot-plugin-wordpress"}'
   ```
3. Restart DevOps Pilot
4. Open Settings > Plugins > WordPress and enter your credentials

### Option 2: Install from registry (once published)

Use Settings > Plugins > Browse in DevOps Pilot and click Install.

## Configuration

You need a WordPress **application password**, not your regular login password.

1. Log in to wp-admin
2. Go to **Users > Profile** (or Users > Your user)
3. Scroll to **Application Passwords**, name it (e.g. "DevOps Pilot"), click **Add New Application Password**
4. Copy the generated password (format: `xxxx xxxx xxxx xxxx xxxx xxxx`) -- you only see it once
5. In the DevOps Pilot WordPress tab, click the settings gear and enter:
   - **Site URL**: `https://yoursite.com` (no trailing slash)
   - **Username**: your wp-admin login name
   - **Application Password**: the generated password (keep the spaces)
6. Click **Save & test**. The connection dot turns green on success.

To revoke access, delete the application password in wp-admin -- DevOps Pilot loses access immediately.

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
