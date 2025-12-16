# Kaneshiro Enterprises - Business Management Hub

A unified web-based dashboard system for managing two distinct businesses under Kaneshiro Enterprises:
1. **Kintsugi Motorworks** - Vehicle repair and mechanic performance tracking
2. **TakoSoya** - Food service sales to law enforcement with payment tracking

## Overview

The main landing page provides access to both business dashboards:

### Kintsugi Motorworks
- Mechanic payouts and performance tracking
- Repair job management
- Weekly and monthly reports
- Bank transaction management
- Connected to the original Kintsugi Motorworks Google Sheet

### TakoSoya
- TakoSoya orders to deputies
- Sales revenue and outstanding balances
- Deputy order history and profiles
- Payment tracking for amounts owed by PD/Mayor's office
- Connected to the TakoSoya Google Sheet

## Google Sheet Configuration

### TakoSoya Google Sheet
**Sheet ID:** `1dE7HwPTh07G6gvNfnd45JiZ2arRH3RnheekPFr-p5Ro`

[Open the TakoSoya Google Sheet](https://docs.google.com/spreadsheets/d/1dE7HwPTh07G6gvNfnd45JiZ2arRH3RnheekPFr-p5Ro/edit?gid=175091786#gid=175091786)

Required tabs:
1. **Orders** - Order records (Deputy/Name, Date, Quantity, Price, Agency)
2. **Deputies** - Deputy information (Deputy/Name, State ID)
3. **Payout** - Payment tracking (Agency, Balance Owed, Date)

### Kintsugi Motorworks Google Sheet
**Sheet ID:** `1EJxx9BAUyBgj9XImCXQ5_3nr_o5BXyLZ9SSkaww71Ks`

Required tabs:
1. **Form responses 1** - Job records (Mechanic, How many Across, Week Ending, Month Ending)
2. **State ID's** - Mechanic state IDs
3. **bank_transactions_[timestamp]** - Bank transactions

### Optional Tabs (both sheets)
- **Config** - Configuration values as Key-Value pairs
- **Manual** - Manual override values

### Sheet Sharing Settings

**Important:** The Google Sheet must be set to "Anyone with the link can view" for the dashboard to access it.

To configure:
1. Open your Google Sheet
2. Click "Share" button
3. Under "General access" select "Anyone with the link"
4. Set permission to "Viewer"
5. Click "Done"

## Features

### Main Hub (index.html)
- Unified landing page for Kaneshiro Enterprises
- Quick access to both business dashboards
- Business overview cards

### TakoSoya Business
**Dashboard** - Overview of orders, sales, and outstanding balances
**Orders Page** - Filterable order list with export and search
**Deputies Page** - Deputy performance profiles and order history
**Payout Page** - Track payments owed to the business

### Kintsugi Motorworks Business
**Dashboard** - Mechanic performance and payout overview
**Payouts Page** - Weekly/monthly mechanic payouts with job details
**Mechanics Page** - Mechanic profiles with repair statistics
**Bank Page** - Transaction viewer with BET and bins tracking

## Technology Stack

- **Frontend:** Pure HTML, CSS, and JavaScript (no build step required)
- **Data Source:** Google Sheets (via CSV export API)
- **Styling:** Custom CSS with shared styles
- **Dependencies:** None (uses vanilla JavaScript)

## File Structure

```
/
├── index.html                  # Main Kaneshiro Enterprises hub
├── constants.js                # Configuration constants
├── kintsugi-core.js           # Core utilities (CSV fetch, date/money formatting)
├── shared-styles.css          # Shared styles across all pages
│
├── TakoSoya/                   # TakoSoya business
│   ├── index.html             # TakoSoya dashboard
│   ├── dashboard-script.js    # TakoSoya dashboard logic
│   ├── Orders/                # Order management
│   ├── Deputies/              # Deputy profiles
│   └── Payout/                # Payment tracking
│
└── Kintsugi/                   # Kintsugi Motorworks business
    ├── index.html             # Kintsugi dashboard
    ├── dashboard-script.js    # Kintsugi dashboard logic
    ├── Payouts/               # Mechanic payouts
    ├── Mechanics/             # Mechanic profiles
    └── Bank_Record/           # Bank transactions
```

## Local Development

To run the dashboard locally:

1. Clone the repository
2. Start a local web server:
   ```bash
   python3 -m http.server 8080
   ```
3. Open http://localhost:8080 in your browser

## Column Name Flexibility

The dashboard uses flexible column matching, so your Google Sheet columns don't need exact names. It will look for columns containing keywords like:

- **Deputy:** "deputy", "mechanic", "name"
- **Quantity:** "quantity", "qty", "amount", "across"
- **Date:** "date", "time", "timestamp"
- **Agency:** "agency", "department", "dept"
- **Price:** "price", "cost", "total"

This makes it easy to use your existing sheet structure.

## Customization

### Changing the Google Sheets

**For TakoSoya:**
1. Open `kintsugi-core.js`
2. Update `KINTSUGI_SHEET_ID` to your TakoSoya sheet ID
3. Ensure your sheet has tabs: Orders, Deputies, Payout

**For Kintsugi Motorworks:**
1. The original sheet ID is already configured in `kintsugi-core.js`
2. Kintsugi uses: Form responses 1, State ID's, bank_transactions

### Updating Sheet Names

If your sheet tabs have different names:
1. Open `constants.js`
2. Update the `KINTSUGI_CONFIG.SHEETS` object with your tab names

### Styling

- Edit `shared-styles.css` for global styling changes
- Edit page-specific CSS files for individual page styling

## Browser Support

The dashboard works in all modern browsers:
- Chrome/Edge (recommended)
- Firefox
- Safari
- Opera

## Troubleshooting

### Data Not Loading

1. **Check Sheet Sharing:** Ensure the Google Sheet is set to "Anyone with the link can view"
2. **Verify Sheet ID:** Confirm the sheet ID in `kintsugi-core.js` is correct
3. **Check Tab Names:** Verify the tab names match those in `constants.js`
4. **Browser Console:** Open browser developer tools (F12) and check for error messages

### Empty Tables

- Ensure your sheet has data in the expected columns
- Check that column names contain the expected keywords
- Verify dates are in a recognized format (DD/MM/YYYY, MM/DD/YYYY, or YYYY-MM-DD)

## License

This project is provided as-is for Kaneshiro Enterprises.

## Support

For questions or issues with the dashboard, check the browser console for error messages and verify your Google Sheet configuration.
