# Kaneshiro Enterprises Business Platform

**Production-grade internal business platform for Kaneshiro Enterprises and its subsidiaries: Kintsugi and Takosuya.**

## Overview

This platform provides unified oversight and operational management across Kaneshiro Enterprises' business portfolio while preserving the distinct identity and workflows of each subsidiary.

### Business Structure

- **Kaneshiro Enterprises** (Parent) - Executive oversight and consolidated reporting
- **Kintsugi** (Subsidiary) - Elegant craftsmanship-focused automotive repair services
- **Takosuya** (Subsidiary) - Fast-paced Japanese street food operations

## Features

### Kaneshiro Enterprises Dashboard (Executive)
- **Consolidated KPIs**: Total revenue, orders, payouts, and active staff across all businesses
- **Subsidiary Comparison**: Side-by-side performance metrics for Kintsugi vs Takosuya
- **Trend Indicators**: Compare current period vs previous period with percentage changes
- **Alerts System**: Notifications for missing payouts, unassigned staff, and missing state IDs
- **Executive Summary**: One-click copyable summary suitable for reporting
- **Design**: Black base with gold accents, dense authoritative layout

### Kintsugi Dashboard (Craftsmanship)
- **Repair-Centric Language**: Uses "repairs", "mechanics", "clients" terminology
- **Category Breakdown**: Standard repairs, engine replacements, and special work
- **Mechanic Performance**: Per-mechanic craftsmanship view with repairs completed and revenue generated
- **Weekly/Monthly Summaries**: Elegant summaries with copyable text format
- **Payout Management**: Gold-emphasized payout summaries for mechanics
- **Historical Repairs**: Searchable table of all repair work with filtering
- **Design**: Charcoal/slate base with gold vein accents, spacious elegant layout, slow refined animations

### Takosuya Dashboard (Operations)
- **Operations-Focused**: Fast-paced order management and throughput tracking
- **Quick Stats**: Avg order value, orders/hour, active team, target progress
- **Team Performance**: Individual performance metrics for all team members
- **Category Breakdown**: Food orders, beverages, specials with visual icons
- **Payout Summaries**: Quick copyable payout summaries for bank transfers
- **Recent Orders**: Real-time order tracking with search and filtering
- **Daily Summary**: Operational metrics with print and copy functionality
- **Design**: Warm tones (red/orange/cream), rounded UI, friendly typography, energetic transitions

## Architecture

### Project Structure

```
/
├── core/                           # Shared core functionality
│   ├── data/
│   │   └── ingestion.js           # Google Sheets data fetching
│   ├── models/
│   │   ├── order.js               # Order/Repair model
│   │   ├── payout.js              # Payout model
│   │   └── staff.js               # Staff/Deputy model
│   ├── utils/
│   │   ├── aggregations.js        # Data aggregation helpers
│   │   ├── subsidiary-rules.js    # Rules engine for data assignment
│   │   └── time-controls.js       # Time range filtering
│   ├── components/
│   │   └── kpi-card.js            # Reusable KPI component
│   ├── theme-engine/
│   │   └── theme-engine.js        # Theme management system
│   └── navigation/
│       └── navigation.js          # Navigation hierarchy management
│
├── kaneshiro/                      # Executive dashboard
│   ├── kaneshiro-index.html
│   ├── kaneshiro-style.css
│   └── kaneshiro-script.js
│
├── kintsugi/                       # Kintsugi subsidiary dashboard
│   ├── kintsugi-index.html
│   ├── kintsugi-style.css
│   ├── kintsugi-script.js
│   ├── kintsugi-theme.js          # Theme configuration
│   └── kintsugi-rules.js          # Business rules configuration
│
└── takosuya/                       # Takosuya subsidiary dashboard
    ├── takosuya-index.html
    ├── takosuya-style.css
    ├── takosuya-script.js
    ├── takosuya-theme.js          # Theme configuration
    └── takosuya-rules.js          # Business rules configuration
```

### Data Flow

1. **Data Ingestion** (`core/data/ingestion.js`)
   - Fetches data from Google Sheets via CSV export URLs
   - Caches data for 5 minutes to reduce API calls
   - Parses CSV and normalizes into structured objects

2. **Data Normalization** (`core/models/*.js`)
   - `Order`: Normalizes orders/repairs with consistent date formats, currency parsing, and category mapping
   - `Payout`: Normalizes payout data with week parsing and type categorization
   - `Staff`: Normalizes staff data with active status and metrics

3. **Subsidiary Assignment** (`core/utils/subsidiary-rules.js`)
   - Rules-based engine assigns data to Kintsugi or Takosuya
   - Uses keywords, categories, and roles for intelligent classification
   - Configurable per business via rules files

4. **Time Controls** (`core/utils/time-controls.js`)
   - Global time range selector (Day/Week/Month/Custom)
   - All KPIs and tables respond to time range changes
   - Provides previous period data for trend calculations

5. **Theme Engine** (`core/theme-engine/theme-engine.js`)
   - Manages subsidiary-specific theming
   - Applies CSS variables for colors, fonts, spacing
   - Handles animation speeds and design density

## Data Sources

The platform connects to Google Sheets as the single source of truth:

### Required Sheets

1. **Orders Sheet** (GID: 175091786)
   - Columns: Date, Customer, Category/Type, Staff/Mechanic, Total/Amount, Status, Notes
   - Used for: Order tracking, revenue calculation, category analysis

2. **Payouts Sheet** (GID: 425317715)
   - Columns: Person, StateID, Week, Amount, Type, Notes
   - Used for: Payout calculations, earnings tracking, bank summaries

3. **Deputies/Staff Sheet** (GID: 0)
   - Columns: Name, StateID, Role, Active/Status, Business
   - Used for: Staff tracking, performance metrics, alerts

### Sheet Configuration

The Google Sheet ID is configured in `core/data/ingestion.js`:

```javascript
const sheetId = '1dE7HwPTh07G6gvNfnd45JiZ2arRH3RnheekPFr-p5Ro';
```

**Note**: Sheets must be publicly accessible or published to the web for CSV export to work.

## Setup & Installation

### Prerequisites

- A modern web browser (Chrome, Firefox, Safari, Edge)
- A web server (can be local or remote)
- Access to the Google Sheets data sources

### Quick Start

1. **Clone or download the repository**

2. **Serve the files with a web server**

   **Option A: Using Python (simplest)**
   ```bash
   # Python 3
   python -m http.server 8000
   
   # Python 2
   python -m SimpleHTTPServer 8000
   ```

   **Option B: Using Node.js**
   ```bash
   npx serve .
   ```

   **Option C: Using PHP**
   ```bash
   php -S localhost:8000
   ```

3. **Open the platform in your browser**
   - Kaneshiro Executive: `http://localhost:8000/kaneshiro/kaneshiro-index.html`
   - Kintsugi Dashboard: `http://localhost:8000/kintsugi/kintsugi-index.html`
   - Takosuya Dashboard: `http://localhost:8000/takosuya/takosuya-index.html`

### Configuration

#### Updating Google Sheets Connection

Edit `core/data/ingestion.js` to change the sheet ID or GIDs:

```javascript
constructor(sheetId) {
  this.sheetId = sheetId || 'YOUR_SHEET_ID_HERE';
}

// Update GIDs in fetchOrders, fetchPayouts, fetchStaff methods
```

#### Customizing Subsidiary Rules

Edit `kintsugi/kintsugi-rules.js` or `takosuya/takosuya-rules.js` to adjust:
- Keywords for data assignment
- Category mappings
- Payment rates
- Display preferences

#### Adjusting Themes

Edit `kintsugi/kintsugi-theme.js` or `takosuya/takosuya-theme.js` to customize:
- Color palettes
- Font families
- Spacing values
- Border radius
- Animation speeds

## Usage Guide

### Navigation

- **Global Navigation Bar**: Always shows Kaneshiro Enterprises with links to subsidiaries
- **Subsidiary Pages**: Include "A Kaneshiro Enterprise" subtitle
- **Context Switching**: Changes theme, data scope, and UX philosophy

### Time Controls

All dashboards include time range selectors:
- **Day**: Current day
- **Week**: Current week (Monday-Sunday)
- **Month**: Current month
- **Custom**: Select custom date range

Time controls affect:
- All KPI calculations
- Trend indicators (vs previous period)
- Tables and lists
- Summary generation

### Features by Dashboard

#### Kaneshiro Enterprises

- **Consolidated KPIs**: View metrics across all businesses
- **Subsidiary Cards**: Quick comparison of Kintsugi vs Takosuya
- **Alerts**: Monitor system health and data quality
- **Executive Summary**: Copy summary for reporting
- **Export Report**: Download summary as text file

#### Kintsugi

- **Repair KPIs**: Total repairs, revenue, avg value, engine replacements
- **Category Breakdown**: Visual cards for each repair category
- **Mechanic Performance**: Individual craftsman metrics
- **Weekly/Monthly Tabs**: Switch between summary views
- **Payout Management**: View and copy payout summaries
- **Repair History**: Searchable, filterable table of all repairs
- **Refresh Data**: Force reload from Google Sheets

#### Takosuya

- **Operations KPIs**: Orders, revenue, payouts, team size
- **Quick Stats**: Avg order value, orders/hour, target progress
- **Team Performance**: Individual team member metrics
- **Category Breakdown**: Visual breakdown by order type
- **Payouts**: Quick copy for bank transfers
- **Orders Table**: Real-time order tracking with search
- **Daily Summary**: Print or copy operational summary

### Keyboard Shortcuts

- **Refresh Data**: Click refresh button on any page
- **Copy Summaries**: Use dedicated copy buttons
- **Search**: Use search fields in tables for quick filtering

### Responsive Design

All dashboards are fully responsive and work on:
- Desktop (1440px+)
- Tablet (768px-1440px)
- Mobile (320px-768px)

## Customization

### Adding New Subsidiaries

1. Create new folder: `/newsubsidiary/`
2. Create files: `index.html`, `style.css`, `script.js`, `theme.js`, `rules.js`
3. Register in `core/navigation/navigation.js`
4. Add theme to `core/theme-engine/theme-engine.js`
5. Add rules to `core/utils/subsidiary-rules.js`

### Modifying KPI Calculations

Edit `core/utils/aggregations.js` to adjust:
- Revenue calculations
- Payout groupings
- Staff metrics
- Trend calculations
- Summary generation

### Changing Visual Design

Each subsidiary has independent styling:
- **Kaneshiro**: `kaneshiro/kaneshiro-style.css`
- **Kintsugi**: `kintsugi/kintsugi-style.css`
- **Takosuya**: `takosuya/takosuya-style.css`

CSS variables are defined in `:root` for easy theming.

## Troubleshooting

### Data Not Loading

- **Check Google Sheets Access**: Ensure sheets are published/public
- **Verify Sheet IDs**: Confirm GIDs in `core/data/ingestion.js`
- **Check Browser Console**: Look for CORS or fetch errors
- **Clear Cache**: Force refresh with Ctrl+Shift+R (Windows) or Cmd+Shift+R (Mac)

### Incorrect Subsidiary Assignment

- **Review Rules**: Check `kintsugi-rules.js` and `takosuya-rules.js`
- **Update Keywords**: Add missing keywords to rules
- **Explicit Assignment**: Use `subsidiary` or `business` field in sheet data

### Theme Not Applying

- **Check Navigation Context**: Ensure correct context is set
- **Clear localStorage**: Clear browser storage and reload
- **Verify Theme Registration**: Check `core/theme-engine/theme-engine.js`

### Performance Issues

- **Reduce Data Range**: Use shorter time periods
- **Enable Caching**: Data is cached for 5 minutes by default
- **Optimize Tables**: Use pagination for large datasets

## Browser Support

- **Chrome**: 90+ ✅
- **Firefox**: 88+ ✅
- **Safari**: 14+ ✅
- **Edge**: 90+ ✅

## Security Notes

- **Data Privacy**: All data processing happens client-side
- **No Authentication**: Add authentication layer for production use
- **HTTPS**: Use HTTPS in production environments
- **API Keys**: Store sensitive credentials securely (not in client code)

## Performance

- **Data Caching**: 5-minute cache reduces API calls
- **Lazy Loading**: KPIs and tables load on demand
- **Optimized Rendering**: Efficient DOM updates
- **Responsive Images**: No images used (CSS only)

## Future Enhancements

- [ ] Real-time data updates via WebSockets
- [ ] Advanced filtering and sorting
- [ ] Data export to CSV/PDF
- [ ] Mobile app versions
- [ ] User authentication and permissions
- [ ] Historical data analysis
- [ ] Predictive analytics
- [ ] Multi-language support

## Support

For issues or questions:
1. Check this README first
2. Review browser console for errors
3. Verify Google Sheets configuration
4. Check network tab for API failures

## License

Internal use only. All rights reserved.

---

**Built with ❤️ for Kaneshiro Enterprises**

*Three businesses. One platform. Zero compromises.*
