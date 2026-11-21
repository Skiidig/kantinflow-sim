# Taste

## Writing & Copy

- Wants UI copy written in natural, concise Indonesian — no generic AI filler or corporate boilerplate. Confidence: 0.7

## Frontend Tooling & CSS Architecture

- Prefers design tokens implemented as plain CSS custom properties in a single stylesheet; do not migrate to Tailwind (or its CDN) — wants the Vite build to stay fast and dependency-light. Confidence: 0.7

## Workflow & Verification

- For browser-based visual audits, insists on headless mode and that every temporary browser instance, dev server, and injected test harness is torn down and verified closed afterwards — nothing may be left running or committed. Confidence: 0.6
- For ordinary CSS/markup tweaks, a passing `npm.cmd run build` is sufficient verification — don't spin up dev servers and headless browser audits unless asked. Confidence: 0.55

## Layout & Responsive Design

- Dislikes narrow, centered `max-width` layouts (e.g. `max-w-7xl mx-auto`); wants fluid, left-aligned canvases that fill large and ultrawide monitors while keeping forms and prose constrained for readability. Confidence: 0.7
