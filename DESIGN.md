# Prefetch Design Reference

Design tokens, patterns, and rules extracted from the landing page and app UI. Use this as the single source of truth when building new pages, marketing assets, or evolving the app's visual language.

---

## Color Palette

Dark-mode only. Monochrome-first with a single accent.

### Backgrounds (darkest → lightest)

| Token | Hex | HSL (approx) | Usage |
|---|---|---|---|
| `--bg` | `#09090b` | `240 6% 3.9%` | Page / app background |
| `--bg-subtle` | `#0c0c0e` | `240 8% 4.3%` | Subtle depth layer |
| `--surface` | `#111113` | `240 7% 7%` | Cards, panels, inputs |
| `--surface-hover` | `#18181b` | `240 6% 10%` | Hover state for surfaces |

### Borders

| Token | Hex | Usage |
|---|---|---|
| `--border` | `#1c1c1f` | Default borders, dividers |
| `--border-hover` | `#27272a` | Hover / focus borders |

### Text (brightest → dimmest)

| Token | Hex | Usage |
|---|---|---|
| `--text` | `#fafafa` | Primary text, headings |
| `--text-secondary` | `#a1a1aa` | Body copy, descriptions |
| `--text-tertiary` | `#71717a` | Nav links, labels, captions |
| `--text-muted` | `#52525b` | Section labels, disabled text |

### Accents

| Token | Hex | Usage |
|---|---|---|
| `--accent` | `#a78bfa` | Purple — glow effects, highlights |
| `--accent-dim` | `#7c3aed` | Deeper purple — gradient stops |
| `--green` | `#34d399` | Success, live indicators, check marks |

### Mapping to App (shadcn/ui)

The app uses shadcn HSL variables. These align to the same Zinc scale:

| Landing page | App (HSL) | Tailwind class |
|---|---|---|
| `#09090b` | `0 0% 3.9%` | `bg-background` |
| `#111113` | `0 0% 7%` | `bg-card` |
| `#18181b` | `0 0% 14.9%` | `bg-secondary` / `bg-muted` |
| `#fafafa` | `0 0% 98%` | `text-foreground` |
| `#a1a1aa` | `0 0% 63.9%` | `text-muted-foreground` |

---

## Typography

### Fonts

| Context | Font | Fallback stack |
|---|---|---|
| **App UI** | Geist (variable, woff2) | system-ui, sans-serif |
| **Landing page** | Inter (Google Fonts, 400–700) | -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif |
| **Monospace** (both) | SF Mono, Cascadia Code, JetBrains Mono, Fira Code | monospace |

> **Why two fonts?** Geist is loaded locally in the Tauri app for offline use and tighter control. Inter is loaded from Google Fonts on the landing page for zero-config CDN delivery. Both are geometric sans-serifs from the same design lineage — they're visually interchangeable at body sizes.

### Type Scale (Landing Page)

| Element | Size | Weight | Letter-spacing | Notes |
|---|---|---|---|---|
| Hero h1 | `clamp(40px, 6vw, 64px)` | 700 | `-0.04em` | Gradient fill (white → zinc-500) |
| Section title | `clamp(28px, 4vw, 36px)` | 700 | `-0.035em` | |
| Section label | `12px` | 600 | `0.08em` | Uppercase, muted |
| Body (hero) | `17px` | 400 | normal | `--text-secondary` |
| Body (cards) | `13px` | 400 | normal | `--text-secondary`, 1.55 line-height |
| Card title | `14px` | 600 | `-0.01em` | |
| Nav links | `13px` | 500 | normal | `--text-tertiary` |
| Code | `12.5px` | 400 | normal | Mono stack |
| Stat value | `28px` | 700 | `-0.03em` | |
| Stat label | `12px` | 500 | `0.06em` | Uppercase, muted |

### Key Typography Rules

- **Headlines always use negative letter-spacing** (`-0.03em` to `-0.04em`). This is what makes them feel "designed" rather than default.
- **Uppercase labels always use positive letter-spacing** (`0.05em` to `0.08em`). Tight uppercase looks cramped.
- **Body never exceeds 480–540px width.** Use `max-width` on paragraph containers.
- **Gradient text** on hero: `linear-gradient(180deg, #fafafa 40%, #71717a 100%)` with `background-clip: text`.

---

## Spacing System

Not a strict 4/8px grid, but consistent patterns:

| Context | Value | Usage |
|---|---|---|
| Container padding | `24px` horizontal | All sections |
| Max content width | `1080px` | `.container` |
| Section padding | `96px` vertical | Between major sections |
| Hero padding | `180px` top, `120px` bottom | Above fold breathing room |
| Card inner padding | `28px` top/bottom, `24px` sides | Bento cards |
| Gap between cards | `1px` (border trick) | Bento grid |
| Button padding | `10px 20px` (primary), `9px 18px` (secondary) | CTAs |
| Element spacing within cards | `10px` gap | Icon → title → description |

---

## Component Patterns

### Buttons

**Primary** — white on black, bold:
```css
background: #fafafa;
color: #09090b;
font-weight: 600;
border-radius: 8px;
padding: 10px 20px;
/* Hover: translateY(-1px) + subtle white glow shadow */
```

**Secondary** — ghost with border:
```css
background: transparent;
color: #a1a1aa;
border: 1px solid #1c1c1f;
border-radius: 8px;
padding: 9px 18px;
/* Hover: fill surface, brighten text, brighten border */
```

**Rule:** Always pair a primary + secondary CTA. Primary uses action verb ("Download"), secondary uses social proof ("Star on GitHub", "View source").

### Cards (Bento Grid)

- Background: `--surface` (#111113)
- No visible border per-card — use `1px` grid gap with `--border` background on the parent grid
- Outer container gets `border: 1px solid var(--border)` + `border-radius: 12px` + `overflow: hidden`
- Hover: background shifts to `--surface-hover`
- Wide cards: `grid-column: span 2` for emphasis

### Icon Boxes

Small square containers for feature icons:
```css
width: 36px; height: 36px;
background: var(--bg);          /* darker than card */
border: 1px solid var(--border);
border-radius: 8px;
color: var(--text-tertiary);    /* muted icons */
```

Icons are 18×18px Lucide-style strokes (2px stroke width).

### Code Blocks

```css
font-family: var(--mono);
font-size: 12.5px;
color: var(--text-secondary);
/* Inside a card with copy button absolutely positioned top-right */
```

### Badges

Pill-shaped, subtle:
```css
border: 1px solid var(--border);
border-radius: 100px;
padding: 5px 14px;
font-size: 12px;
font-weight: 500;
color: var(--text-tertiary);
```

Can include a pulsing dot for "live" indicators:
```css
.dot {
  width: 6px; height: 6px;
  border-radius: 50%;
  background: var(--green);
  box-shadow: 0 0 8px rgba(52, 211, 153, 0.4);
  animation: pulse 2s ease-in-out infinite;
}
```

---

## Visual Effects

### Noise Texture

Fixed overlay on `body::before`, `z-index: 9999`, `pointer-events: none`, `opacity: 0.025`. Uses inline SVG `feTurbulence` filter (fractalNoise, baseFrequency 0.9, 4 octaves). Adds subtle grain that prevents the dark background from looking like a dead LCD panel.

### Radial Glow

Behind hero and bottom CTA sections:
```css
background: radial-gradient(
  ellipse at center,
  rgba(167, 139, 250, 0.08) 0%,    /* accent purple */
  rgba(124, 58, 237, 0.03) 40%,
  transparent 70%
);
```
Absolutely positioned, large (800×600px), centered. Subtle — you feel it more than see it.

### Frosted Glass Nav

```css
background: rgba(9, 9, 11, 0.8);   /* bg at 80% opacity */
backdrop-filter: blur(12px);
border-bottom: 1px solid transparent;  /* shows on scroll */
```

### Gradient Text

Hero headline uses vertical gradient from white to zinc-500:
```css
background: linear-gradient(180deg, #fafafa 40%, #71717a 100%);
-webkit-background-clip: text;
-webkit-text-fill-color: transparent;
```

### Transitions

Everything uses `0.2s` ease (default). Nav border uses `0.3s`. No springs, no bounce — keep it sharp and intentional.

---

## Layout Patterns

### Bento Grid

3-column grid at desktop. Alternate `span-2` cards per row for visual rhythm:
- Row 1: `[span-2] [1]`
- Row 2: `[1] [span-2]`
- Row 3: `[1] [1] [1]`

Falls to single column on mobile.

### Comparison Table

Grid-based, not `<table>`. 3-column (`label | us | them`). Green checks (✓) vs muted crosses (✗). First column has white text on surface bg, data columns centered.

### Section Rhythm

Every section follows:
```
[section-label]    ← 12px uppercase, muted
[section-title]    ← 28-36px bold, tight tracking
[section-desc]     ← 15px secondary, max-width constrained
[content]          ← cards, grid, table, etc.
```

Separated by `border-top: 1px solid var(--border)` + `96px` vertical padding.

---

## Responsive Breakpoints

| Breakpoint | What changes |
|---|---|
| `768px` | Bento → single column, install cards → stacked, nav links hidden |
| `480px` | Hero CTAs → full-width stacked, stats → vertical, smaller type |

---

## Voice & Copy

### Rules

- **Terse over verbose.** "Git, without the cognitive overhead" — not "A modern git client designed to reduce complexity."
- **Confidence without arrogance.** "Fast. Actually." — not "The fastest git client ever built."
- **Address the pain.** "You shouldn't need a subscription to see your branches."
- **No marketing fluff.** No "revolutionary", "next-gen", "AI-powered", "blazingly fast". State facts: "10 MB, starts in under a second."
- **Imperative CTAs.** "Download", "Star on GitHub", "Try it." — not "Get started" or "Learn more".

### Taglines (approved)

- "Git client for people who ship"
- "Git, without the cognitive overhead"
- "Same power, none of the bloat"
- "Try it. It's free."
- "No account, no trial, no catch."

---

## File Reference

| File | What it controls |
|---|---|
| `docs/index.html` | Landing page (standalone, no build step) |
| `src/index.css` | App theme tokens (shadcn/ui, Tailwind v4) |
| `components.json` | shadcn/ui config (Neutral base, Lucide icons) |
| `public/fonts/` | Geist + Geist Mono woff2 files |
