# AI Rank Admin Section

The admin area (`/admin`) provides operational control over the AI Rank intelligence terminal. It extends the existing Cobalt & Cream visual system with dense, information-rich interfaces designed for extended use.

## Design System

**Visual Identity:**
- **Colors**: Cream background (`--background`), deep ink text (`--foreground`), electric cobalt accents (`--primary`)
- **Typography**: Outfit (sans-serif) for headings, Space Mono (monospace) for data and controls
- **Layout**: Dense, organized information displays with thoughtful card grouping and clear hierarchy
- **Interaction**: Immediate feedback via toasts, inline editing dialogs, status badges, enable/disable toggles

## Pages

### `/admin` — Survey Run Control
- View execution history with status, timing, success/failure counts
- Trigger manual survey runs
- Monitor real-time progress with auto-refresh during active runs
- Inspect error details for failed/partial runs
- Dashboard stats: total runs, average success rate, failed count

### `/admin/brands` — Industry & Brand Catalog
- Manage industries: create, rename, enable/disable
- Manage brands within industries: add, rename, enable/disable
- Collapsible industry cards with brand counts
- Search across industries and brands
- Disabled items are excluded from future survey runs

### `/admin/engines` — AI Engine Configuration
- List all AI engines with provider, model, vendor details
- Add new engines (key, name, vendor, provider, model)
- Edit engine metadata and model strings
- Enable/disable engines for survey participation
- Provider badges: OpenAI (green), Anthropic (orange), Gemini (blue), OpenRouter (purple)

### `/admin/api-keys` — Provider Credentials
- Manage API keys per provider (OpenAI, Anthropic, Gemini, OpenRouter)
- Three key sources:
  - **env**: Built-in Replit AI integration (default)
  - **stored**: Custom key set by user (masked after save)
  - **none**: No key configured
- Set custom keys (overrides env), clear to revert to default
- Keys are never exposed in full — only last 4 characters shown

### `/admin/data` — Database Browser
- Read-only access to raw database tables
- Tables: industries, brands, engines, survey_runs, survey_responses
- Paginated views (50 rows per page)
- JSON fields expand on click
- Long text truncates with expand option

## Navigation

Admin sub-navigation appears as a sticky tab bar below the main header when on any `/admin/*` route. Current section is highlighted with cobalt underline.

## Data Flow

All mutations invalidate both:
- `getGetAdminCatalogQueryKey()` — admin-specific catalog (includes disabled items)
- `getGetCatalogQueryKey()` — public catalog (enabled items only)

This ensures the public Intelligence Overview and Industry pages refresh immediately after admin changes.

## Implementation Notes

- All admin hooks imported from `@workspace/api-client-react`
- Query hooks return `T` directly (not wrapped in `{ data: T }`)
- Mutations use `onSuccess` / `onError` for toast feedback
- Auto-refresh during active survey runs (3s polling interval)
- Collapsible sections preserve state during session
- Forms validate before submit, disable button during pending mutations

## Accessibility

- `data-testid` attributes on all interactive elements and key data displays
- Pattern: `button-{action}-{target}`, `text-{content}-{id}`, `card-{type}-{id}`
- Keyboard navigable dialogs, selects, and collapsibles
- Loading skeletons during data fetch
- Empty states with clear CTAs
