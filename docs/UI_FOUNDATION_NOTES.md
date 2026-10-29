# UI Foundation — Reference Fidelity Notes

Stage: UI foundation (28 Oct 2026). Reference inspected read-only at 1440×900, 1024×768, 768×1024 and 375×812.

## Matched against the live reference (measured)

| Area | Reference value | Implementation |
|---|---|---|
| Sidebar | 256px, white, right hairline border; brand block 80px; search 37px tall with "/" hint | Same; groups at y=145/233…, labels 11px/900/0.1em uppercase zinc-400 |
| Nav items | 40px tall, 12px radius, 10×14 padding, 14px bold zinc-700, 20px icons zinc-400, 4px gap; active = green gradient `#107C41→#0A5D2B`, white text and dot | Identical positions verified (231×40 at x=12) |
| Sidebar footer | User card 16px radius, zinc-50/70 bg, avatar 38px gradient + presence dot, Workspace row | Same (signed-out state) |
| Header | 57px sticky, white/95 + blur, border zinc-200/60; 40px menu button; user chip; pill project selector (max 576px) with "PROJECT" label + divider; 36px bell; 36px bordered action | Same layout and sizes |
| Breakpoints | ≥1024px docked sidebar (menu button collapses it); <1024px overlay drawer with backdrop | Same; Escape and backdrop close the drawer |
| Main | bg `#F6F8F7`; padding 32/40 (≥1024), 24 (768), 24/16 (375) | Same |
| Phone header | Two rows (~109px): controls, then full-width project selector | Same |
| Typography | Geist / Geist Mono; heavy 900 weights; uppercase micro-labels with letter spacing | Same |
| Colours | Tailwind zinc scale, amber/rose/sky accents, brand green `#107C41`, tint `#E7F3EC` | Same tokens (`globals.css`) |
| Dashboard order | Hero → Executive Essentials (5 KPIs, team/range bar, Organization Health + Top Projects) → Instant Insights (header, 4 mini stats, 3 panels, My Targets + Meetings Distribution) → Aging vs Meetings → Lead sources + Inbound channels → Recent leads | Same order and grids |
| Cards | KPI 16px radius / 16px padding; panels 24px radius with 16/24 header; empty boxes 12px radius | Same |
| Table | Header 10px bold uppercase zinc-400; rows 12px; neutral status chips; letter tile | Same |
| Module header | White 24px-radius card, 24px padding, 32px green icon box, 20px/900 title, 12px description | Same (`PageHeader`) |

## Branding changes

- "SaleStorm" wordmark → **MZ MARKETING** text wordmark (same 18px/900 uppercase treatment). The reference's small "CRM" chip is dropped because the longer name would overflow 256px; subtitle reads "Real Estate CRM".
- Logo image → text monogram "MZ" in the same 40px tinted, ringed box (no invented logo). Favicon is the same text monogram.
- Hero pill "SALESTORM CRM" → "MZ MARKETING CRM"; footer workspace → "MZ MARKETING".

## Honest states (no fake functionality)

- No session yet: avatar placeholders, "Not signed in", **Sign in** link in place of "Log out".
- Project selector is disabled with "No projects yet" until the database exists.
- Dashboard widgets render em dashes and empty boxes; the hero says the data source is not connected.
- Login form shows "Sign-in is not connected yet" instead of signing in.
- Module routes show a "not built yet" card with the module's real title and description.
- `/dev/dashboard-preview` shows clearly labelled sample data for layout comparison; it is 404 in production builds.

## Assumptions (not verifiable in the reference)

| Item | Why | Choice |
|---|---|---|
| Login page | Inspecting it would require signing out | Built from the reference's brand block, card and field styles |
| Hover / focus states | Only partially observable | zinc-100 hover, brand focus ring |
| Sidebar group spacing when data loaded vs. loading | Identical in both states | — |
| Some icons | Reference uses Feather-style SVGs; mapped to closest lucide-react icons (e.g. Targets → `Target`, Bookings → `BookText`) | May differ slightly in glyph detail |
| Drawer backdrop colour | Observed as a light grey wash | zinc-950/20 with slight blur |
| Status colours elsewhere (lead stages in module tables) | Not yet compared | Defined in `Badge`/`StatusTag` tones; verify per module |
| Data in reference widgets that depend on role (e.g. "Lost leads by reason/team" seen while loading) | Appeared only during loading as a Sales Agent | Not included; confirm with admin walkthrough |
