# Kaneshiro Enterprises - TakoSoya Sales Tracking Dashboard

A web-based dashboard for tracking TakoSoya sales to deputies and managing payments owed by PD/Mayor's office to Kaneshiro Enterprises.

## Overview

This dashboard connects to a Google Sheets database to provide real-time tracking of:
- TakoSoya orders to deputies
- Sales revenue and outstanding balances
- Deputy order history and profiles
- Payment tracking for amounts owed to the business

## Google Sheet Configuration

The dashboard reads data from this Google Sheet:
**Sheet ID:** `1dE7HwPTh07G6gvNfnd45JiZ2arRH3RnheekPFr-p5Ro`

[Open the Google Sheet](https://docs.google.com/spreadsheets/d/1dE7HwPTh07G6gvNfnd45JiZ2arRH3RnheekPFr-p5Ro/edit?gid=175091786#gid=175091786)

### Required Sheet Tabs

The dashboard expects the following tabs in your Google Sheet:

1. **Orders** - Contains order records with columns like:
   - Deputy/Name
   - Date/Timestamp
   - Quantity/Amount
   - Price/Total
   - Agency/Department (optional)

2. **Deputies** - Contains deputy information with columns like:
   - Deputy/Name
   - State ID (optional)
   - Contact info (optional)

3. **Payout** - Contains payment tracking with columns like:
   - Agency/Department
   - Balance/Amount Owed
   - Date
   - Status (optional)

4. **Config** (optional) - Configuration values as Key-Value pairs

5. **Manual** (optional) - Manual override values

### Sheet Sharing Settings

**Important:** The Google Sheet must be set to "Anyone with the link can view" for the dashboard to access it.

To configure:
1. Open your Google Sheet
2. Click "Share" button
3. Under "General access" select "Anyone with the link"
4. Set permission to "Viewer"
5. Click "Done"

## Features

### Dashboard (index.html)
- Overview of all-time orders and sales revenue
- Outstanding balance owed by PD/Mayor's office
- Active deputies count
- This week/month statistics
- Top deputy of the week
- Quick navigation to detailed views

### Orders Page (Payouts/)
- Filterable list of all TakoSoya orders
- Filter by deputy, agency, week, or month
- Search functionality
- Export to CSV
- Copy order summaries to clipboard
- Weekly and monthly views

### Deputies Page (Mechanics/)
- Deputy performance profiles
- Total orders per deputy
- Activity ranges and statistics
- Weekly breakdown per deputy
- Search and sort functionality

### Payout Page (Bank_Record/)
- Track payments owed to Kaneshiro Enterprises
- View outstanding balances by agency
- Filter and search transaction history
- Export payment records

## Technology Stack

- **Frontend:** Pure HTML, CSS, and JavaScript (no build step required)
- **Data Source:** Google Sheets (via CSV export API)
- **Styling:** Custom CSS with shared styles
- **Dependencies:** None (uses vanilla JavaScript)

## File Structure

```
/
├── index.html                  # Main dashboard
├── dashboard-script.js         # Dashboard logic
├── constants.js                # Configuration constants
├── kintsugi-core.js           # Core utilities (CSV fetch, date/money formatting)
├── shared-styles.css          # Shared styles across pages
├── dashboard-style.css        # Dashboard-specific styles
├── Payouts/
│   ├── payouts-index.html     # Orders page
│   └── payouts-script.js      # Orders logic
├── Mechanics/
│   ├── mechanics-index.html   # Deputies page
│   └── mechanics-script.js    # Deputies logic
└── Bank_Record/
    ├── bank-index.html        # Payout tracker page
    └── bank-script.js         # Payout logic
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

### Changing the Google Sheet

To point the dashboard to a different Google Sheet:
1. Open `kintsugi-core.js`
2. Update the `KINTSUGI_SHEET_ID` constant with your sheet ID
3. Ensure your sheet has the required tabs (Orders, Deputies, Payout)

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
