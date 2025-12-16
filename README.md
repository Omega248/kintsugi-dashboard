# Kaneshiro Enterprises - Unified Business Management Platform

A single, cohesive platform for managing Kaneshiro Enterprises and its two subsidiaries: Kintsugi Motorworks and Takosuya.

## Quick Start

1. **Open in browser**: Simply open `index.html` in a modern web browser
2. **Or use local server**:
   ```bash
   python3 -m http.server 8080
   # Then open http://localhost:8080
   ```

## Architecture

**Single Codebase** with:
- Unified data layer (Google Sheets integration)
- Multi-tenant theming (Kaneshiro / Kintsugi / Takosuya)
- Shared component library
- Zero code duplication

## File Structure

```
/
├── index.html                    # Main application
├── styles.css                    # Unified design system
├── app.js                        # Application controller
├── config.js                     # Configuration
└── src/
    ├── data/
    │   ├── sheetsClient.js       # Google Sheets client
    │   └── normalizer.js         # Data normalization
    ├── utils/
    │   └── helpers.js            # Utility functions
    └── themes/
        └── themeManager.js       # Theme system
```

## Features

- **Multi-Tenant Views**: Switch between Kaneshiro (All), Kintsugi, or Takosuya
- **Real-time Data**: Auto-syncs with Google Sheets
- **Dynamic Theming**: Each subsidiary has unique visual identity
- **Export/Import**: CSV export, copy summaries to clipboard
- **Responsive**: Works on desktop, tablet, and mobile

## Configuration

Edit `config.js` to customize sheet IDs, subsidiary rules, and themes.

## Google Sheets

Current sheet: `1dE7HwPTh07G6gvNfnd45JiZ2arRH3RnheekPFr-p5Ro`

Required tabs:
- **Orders**: Order records
- **Payouts**: Payment records  
- **Deputies**: Staff information

## Themes

- **Kaneshiro**: Black & gold corporate
- **Kintsugi**: Charcoal with gold accents
- **Takosuya**: Bright Japanese street-food aesthetic
