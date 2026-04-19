# Interactive Astrogem Tool & Bookmarklet Scraper

A high-performance, static-host web tool for analyzing Lost Ark Astrogem efficiency and calculating optimal Baseline Levels (BL).

## Overview
This tool allows users to import their character's Astrogem data directly from `lostark.bible` using a client-side Bookmarklet. It bypasses Cloudflare/CORS restrictions by executing code in the user's own browser session and redirecting data back to the tool via URL parameters.

## Architecture
- **Frontend**: Vanilla HTML5, CSS3, and JavaScript. Hosted as a static site (GitHub Pages compatible).
- **Data Layer**: Powered by a pre-encoded `raw_html.js` containing the base64-encoded reference tables for gem efficiency.
- **Scraper**: A dynamically generated JavaScript Bookmarklet located in `app.js` (`initBookmarklet`).

## Key Files
- `index.html`: Main UI structure, including the Bookmarklet drag-and-drop panel and the calculation results.
- `app.js`: Contains all business logic:
  - `initBookmarklet()`: Generates the minified JS for the scraper.
  - `checkUrlData()`: Parses incoming `?gems=` payloads, calculates gem scores, and sets the tool's Baseline.
  - `render()`: Updates the UI based on the current Baseline Level.
- `styles.css`: Modern, dark-mode CSS with glassmorphism aesthetics.
- `raw_html.js`: The "database" containing the encoded efficiency tables.

## Scraper Logic (Bookmarklet)
The bookmarklet performs the following steps:
1. Targets the "Ark Grid" section of the DOM on `lostark.bible`.
2. Iterates through all tooltip triggers (`[data-melt-tooltip-trigger]`).
3. Dispatches `mouseenter` events at high speed (10ms intervals) to force-render Svelte tooltips.
4. Parses the tooltip HTML for `Astrogem:` markers, Willpower costs, Order/Chaos points, and Option levels.
5. Base64 encodes the JSON result and redirects back to the tool.

## Formula & Scoring
- **WP Score**: `(4 - WillpowerCost) * 2.4`
- **CP Score**: `(Order/ChaosPoints - 4) * 5.14`
- **Option Score**: `StatCoefficient * OptionLevel`
- **Total Score**: Sum of the above.
- **Baseline (BL)**: Mapped from the *weakest* (lowest score) gem found in the character's grid.

## Developer Notes
- **No Backend**: This project is 100% client-side. Do not add server-side dependencies if you wish to maintain GitHub Pages compatibility.
- **Regex Sensitivity**: The scraper relies on the specific DOM structure of `lostark.bible`. If the site changes its tooltip HTML, the regex in `app.js` (`rawJs` template) will need updating.
- **Firefox Restriction**: Note that Firefox blocks bookmarklets on pages with strict Content Security Policies. This tool is optimized for Chromium-based browsers (Chrome/Edge).

## How to Deploy
1. Ensure `index.html`, `app.js`, `styles.css`, and `raw_html.js` are in the root.
2. Push to a GitHub repository.
3. Enable GitHub Pages in settings pointing to the `main` branch.
