## WordPress Plugin -- AI Instructions

WordPress as a screen inside Cadence: every post type the site has, items edited, scheduled, published and previewed, media with alt text, comment moderation, taxonomies, SEO insights, a snapshot before every write, the site's theme, plugins and users, and one script per action for every CLI. The user should not need wp-admin.

**All routes are at** `$CADENCE_API/api/plugins/wordpress/` (the server that opened your shell; fallback `http://127.0.0.1:3800`). Mutating calls (`POST`, `PUT`, `PATCH`, `DELETE`) need the `x-cadence-token: $CADENCE_TOKEN` header. The scripts attach it for you.

### Which site

Several sites can be configured. Every route accepts `?site=<name>` or `?repo=<path>`; without either, the stored active site answers. The scripts pass `-Site <name>`, or the repository the shell is on (`CADENCE_ACTIVE_REPO_PATH`), automatically. Application passwords never leave the server: `GET /sites` returns `appPasswordSet`, not the password.

### Backup first (the plugin does it for you)

Every `PUT`, `PATCH` and `DELETE` on `/content/<restBase>/<id>` and every restore snapshots the item first, on this machine. Before a big rewrite take one by hand (`Backup-WPItem.ps1`) and say so. If an edit goes wrong, restore (`Restore-WPItem.ps1`); never "un-edit" by writing over the top.

### Guardrails - ask the user first

Publishing (draft to publish), editing anything already published, trashing or deleting, uploading media, moderating or replying to comments, changing SEO on published content. Creating drafts and reading anything needs no confirmation.

### Start with context

```bash
curl -s $CADENCE_API/api/plugins/wordpress/health       # types with counts, drafts, pending, scheduled, comments waiting, media, plugins seen, recent items, issues, bridge
curl -s $CADENCE_API/api/plugins/wordpress/discover     # every post type and taxonomy with rest base and counts - read it before touching a custom type
curl -s $CADENCE_API/api/plugins/wordpress/summary      # plain text
```

`restBase` values come from `/discover` or `/health` (`posts`, `pages`, `product`, `elementor_library`, ...). Do not guess.

### Scripts (prefer these)

From bash: `powershell.exe -ExecutionPolicy Bypass -NoProfile -File "./dashboard/plugins/wordpress/scripts/<Name>.ps1" -Param value`. From a PowerShell shell, run them directly. Every script prints JSON (arrays always as arrays) and takes `-Site <name>` when the shell is not on the site's repository.

| Script | Does | Parameters |
|---|---|---|
| `Get-WPHealth.ps1` / `Get-WPSummary.ps1` / `Get-WPDiscover.ps1` / `Get-WPSiteContext.ps1` | The site at a glance; as text; types and taxonomies; theme, plugins, users, bridge | |
| `Get-WPItems.ps1` | Items of a type, one row each (status, slug, builder, words, SEO title and description) | `-Type [-Query] [-Status] [-PerPage] [-Page]` |
| `Find-WPContent.ps1` | Search every type by text | `-Query [-Type]` |
| `Get-WPItem.ps1` | One item in full: content, excerpt, featured image, terms, SEO, layout summary, snapshots | `-Type -Id` |
| `New-WPItem.ps1` | Create from a JSON file (draft unless the file says otherwise) | `-Type -JsonFile` |
| `Update-WPItem.ps1` | Set fields from a JSON file (snapshot first) | `-Type -Id -JsonFile` |
| `Set-WPPostStatus.ps1` | publish, draft, pending, private, future (with `-Date`) | `-Type -Id -Status [-Date]` |
| `Remove-WPItem.ps1` | Trash, or delete for good with `-Force` | `-Type -Id [-Force]` |
| `Copy-WPItem.ps1` | Duplicate as a new draft, layout and SEO included | `-Type -Id [-Title]` |
| `Get-WPSeo.ps1` / `Update-WPSeo.ps1` | Yoast and Rank Math fields; set meta title, description, focus keyword | `-Type -Id [-Title] [-Description] [-Keyword]` |
| `Get-WPInsights.ps1` | Every item with a problem, by kind | `[-Kind draft\|pending\|scheduled\|stale\|missing-seo-title\|missing-seo-description\|long-seo-title\|long-seo-description\|noindex\|thin\|no-featured-image\|no-excerpt]` |
| `Get-WPMedia.ps1` / `Get-WPMediaUsage.ps1` / `Set-WPMediaAlt.ps1` / `Upload-WPMedia.ps1` / `Upload-WPMediaUrl.ps1` / `Remove-WPMedia.ps1` | The library, where a file is used, alt text, uploads, delete | `-Id`, `-Path`, `-Url`, `-AltText` |
| `Get-WPTerms.ps1` / `New-WPTerm.ps1` / `Update-WPTerm.ps1` / `Remove-WPTerm.ps1` | Terms of any taxonomy | `-Taxonomy <restBase> [-Id] [-Name]` |
| `Get-WPComments.ps1` / `Set-WPCommentStatus.ps1` / `Reply-WPComment.ps1` | Moderation | `[-Status]`, `-Id -Action`, `-Id -Post -Text` |
| `Backup-WPItem.ps1` / `Get-WPBackups.ps1` / `Restore-WPItem.ps1` | Snapshots | `-Type -Id`, `-BackupId` |
| `Get-WPElementorPage.ps1` / `Get-WPElementorTemplates.ps1` / `Copy-WPElementorPage.ps1` / `Get-WPBreakdanceTemplates.ps1` | Page-builder layouts | `-Id [-Type] [-Full]`, `-SourceId` |
| `Test-WPBridge.ps1` / `Install-WPBridge.ps1` | Is the bridge installed; download it | `[-Out]` |
| `Get-WPUsers.ps1` / `Get-WPSites.ps1` / `Switch-WPSite.ps1` / `Test-WPConnection.ps1` / `Test-WPPreview.ps1` / `Invoke-WPRaw.ps1` | Users; configured sites; active site; the login; a URL; any wp-json route | `-Name`, `-Url`, `-Path [-Method] [-Body] [-Query]` |

### Items

```bash
curl -s "$CADENCE_API/api/plugins/wordpress/entries?type=pages&status=draft&q=&page=1"      # one row per item
curl -s "$CADENCE_API/api/plugins/wordpress/item?type=pages&id=28"                          # content, excerpt, terms (with every option), featured image, seo, elementor summary, backups
curl -s -X POST $CADENCE_API/api/plugins/wordpress/content/posts -H "Content-Type: application/json" -H "x-cadence-token: $CADENCE_TOKEN" -d '{"title":"...","content":"<p>...</p>","status":"draft","categories":[5]}'
curl -s -X PUT  $CADENCE_API/api/plugins/wordpress/content/pages/28 -H "Content-Type: application/json" -H "x-cadence-token: $CADENCE_TOKEN" -d '{"status":"publish"}'
```

Item fields: `title`, `content` (HTML or block markup), `excerpt`, `status` (`draft`, `publish`, `pending`, `future` with `date`, `private`), `slug`, `date`, `featured_media`, `author`, `parent`, `menu_order`, `comment_status`, any taxonomy by its rest base (`categories`, `tags`, `product_cat`: arrays of term ids), `meta` (SEO keys: `_yoast_wpseo_title`, `_yoast_wpseo_metadesc`, `_yoast_wpseo_focuskw`, or `rank_math_title`, `rank_math_description`, `rank_math_focus_keyword`).

Page builders: an item's `builder` (`elementor`, `breakdance`, `bricks`, `beaver`, `divi`, `gutenberg`, `classic`) says where its layout lives. Elementor layouts are read through `GET /elementor/page/<id>?type=<restBase>` (with a `summary`: sections, widgets, text) and written through `PUT` on the same route only when the bridge mu-plugin is installed (`GET /bridge/status`). Without the bridge, writes to layouts return 200 and change nothing; say so instead of retrying.

### Insights

`GET /insights` reads up to 500 items per public post type and returns `counts`, `entries` with `issues` (`draft`, `pending`, `scheduled`, `private`, `stale` 180 days, `missing-seo-title`, `missing-seo-description`, `long-seo-title` over 60, `long-seo-description` over 160, `noindex`, `thin` under 50 words on a post or page with no builder, `no-featured-image`, `no-excerpt`, `untitled`), and `imagesNoAlt` (a sample of images without alt text). SEO title and description are what Yoast renders; the stored value may be a `%%template%%`.

### Other routes

`GET /media?per_page=&page=&search=&media_type=`, `GET /media/<id>/usage`, `PUT /media/<id>` (`alt_text`, `title`, `caption`), `POST /media/upload {filePath}`, `POST /media/upload-url {url}`, `DELETE /media/<id>`; `GET /terms/<restBase>?q=`, `POST /terms/<restBase>`, `PATCH|DELETE /terms/<restBase>/<id>`; `GET /comments?status=hold`, `POST /comments`, `POST /comments/<id>/approve|hold|spam|trash`; `GET /seo/<restBase>/<id>`, `PUT /seo/<restBase>/<id> {yoast:{}, rankmath:{}}`; `GET /site` (theme, plugins, users, bridge), `GET /context/full`, `GET /users`, `GET /search?q=&type=`; `POST /backup {restBase,id,reason}`, `GET /backups`, `GET /backups/<restBase>/<id>`, `GET /backup/<backupId>`, `POST /restore/<backupId>`; `GET /elementor/templates`, `POST /elementor/clone {sourceId,sourceType,targetType,title}`, `GET /breakdance/templates`; `GET /preview?url=` (the page for an iframe); `GET /sites`, `POST /sites`, `PATCH /sites/<name>` (a blank `appPassword` keeps the stored one), `DELETE /sites/<name>`, `POST /sites/active {name}`; `POST /raw {method,path,body,query}` for any wp-json route (WooCommerce `/wp-json/wc/v3/products`, ...).

### Writing for the user

SEO title 50 to 60 characters with the focus keyword near the start; meta description 140 to 160 with a call to action; one focus keyword of 1 to 4 words; write for people first. Content as simple HTML (paragraphs, h2 and h3, lists), or block markup if the site uses the block editor; never inline styles or scripts. Create as a draft, hand the link over, publish only when asked.
