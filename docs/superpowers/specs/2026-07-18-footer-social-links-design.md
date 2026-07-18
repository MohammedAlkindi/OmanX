# Footer Social Links — Design Spec

**Date:** 2026-07-18
**Status:** Approved

## Purpose

Add LinkedIn and Instagram links to the site footer so visitors can follow OmanX's official social accounts. Currently the footer has no social presence at all.

## Scope

Applies to the 8 marketing pages that share the standard footer partial:
`index.html`, `meet.html`, `system.html`, `vision.html`, `examples.html`, `contact.html`, `method.html`, `collaboration.html`.

Excluded:
- `dashboard.html` — uses a legacy `.footer-row` layout and is mocked demo content, not a live feature (per project CLAUDE.md).
- `chat.html` — the app shell has no footer at all.

No JavaScript changes. Pure HTML + CSS.

## Links

- LinkedIn: `https://www.linkedin.com/company/omanx`
- Instagram: `https://www.instagram.com/OmanX_org`

## Design

A new `.footer-social` row is added inside each `<footer>`, below the existing `.footer-inner` row (logo / nav links / copyright), separated by a subtle top border matching the footer's own top border (`var(--border)`). This reads as a distinct "follow us" strip without disturbing the existing three-column layout.

Icons are inline SVG (no icon font, no CDN — consistent with the project's no-build-step, no-external-asset convention). Monochrome line icons, default color `var(--ink-4)` (matches `.footer-links a`), hover color `var(--ink)` (matches `.footer-links a:hover`). ~18px, centered in the row, `gap: 16px`.

Markup pattern (repeated per page):

```html
<div class="footer-social">
  <a href="https://www.linkedin.com/company/omanx" target="_blank" rel="noopener noreferrer" aria-label="OmanX on LinkedIn">
    <svg ...>...</svg>
  </a>
  <a href="https://www.instagram.com/OmanX_org" target="_blank" rel="noopener noreferrer" aria-label="OmanX on Instagram">
    <svg ...>...</svg>
  </a>
</div>
```

`target="_blank"` links carry `rel="noopener noreferrer"` to prevent the opened page from accessing `window.opener`.

CSS is added once to `public/styles.css` §13 FOOTER:

```css
.footer-social {
  display: flex;
  justify-content: center;
  gap: 16px;
  margin-top: 20px;
  padding-top: 20px;
  border-top: 0.5px solid var(--border);
}

.footer-social a {
  display: inline-flex;
  color: var(--ink-4);
  transition: color 0.15s;
}

.footer-social a:hover { color: var(--ink); }

.footer-social svg { width: 18px; height: 18px; }
```

## Testing

Visual check only (no build step, no test suite in this project). Load each of the 8 pages locally, confirm the row renders correctly in both light and dark theme, and confirm both links open the correct destination in a new tab.
