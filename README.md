# Kintsugi Motorworks Dashboard

A comprehensive business intelligence dashboard for managing mechanic payouts, job tracking, and financial records.

## 🚀 Features

### Dashboard
- **Real-time Overview**: Live metrics for repairs, payouts, and mechanic activity
- **KPI Cards**: Total repairs, payouts, active mechanics, and current week/month statistics
- **Top Performer Tracking**: Highlights the best-performing mechanic each week
- **BET & Bins Management**: Manual override support for Business Exchange Tokens (BET) and red bins inventory

### Payouts
- **Multi-View System**: Weekly (mechanics), Monthly (repairs), and Jobs views
- **Advanced Filtering**: Filter by mechanic, department, week, month, or custom search
- **Department Support**: Separate billing rates for BCSO ($12,100) and LSPD ($15,000) engine replacements
- **Bill Generation**: Create CSV bills for specific departments and months
- **State ID Integration**: Display mechanic state IDs for easy identification
- **Export Functionality**: Export filtered data to CSV

### Mechanics
- **Performance Profiles**: Detailed statistics for each mechanic
- **Time-Based Analysis**: Filter by last 4 weeks, 3/6/12 months, or this month
- **Sortable Metrics**: Sort by repairs, average per week, weeks worked, or lifetime payout
- **Activity Timeline**: Track first and last job dates

### Bank Records
- **Transaction Viewer**: Comprehensive ledger with categorization
- **BET Tracking**: Automatic detection and calculation of BET purchases/reimbursements
- **Grant Management**: Track grant income and spending
- **Flag System**: Automatic flagging of suspicious or unusual transactions
- **Balance Tracking**: Running balance calculation across all transactions
- **Advanced Filtering**: Filter by direction (in/out), category (BET, grant), with full-text search

## 🎨 Design System

### Color Palette
- **Primary Background**: `#020817` (Deep space blue)
- **Accent Color**: `#4f46e5` (Indigo)
- **Text Primary**: `#e5e7eb` (Light gray)
- **Text Secondary**: `#9ca3af` (Medium gray)

### Typography
- **Font Stack**: System UI fonts for optimal performance
- **Size Scale**: Base-8 spacing system with responsive font sizes
- **Weight Hierarchy**: 400 (regular), 500 (medium), 600 (semibold)

### Components
- **Cards**: Glassmorphic design with subtle gradients
- **Tables**: Sticky headers, hover effects, alternating row colors
- **Buttons**: Multiple variants (primary, secondary, pill-style)
- **Pills**: For categories, tags, and type indicators

## 📱 Responsive Design

The dashboard is fully responsive with breakpoints at:
- **Mobile**: 0-767px
- **Tablet**: 768px-1023px
- **Desktop**: 1024px+
- **Large Desktop**: 1440px+

### Mobile Optimizations
- Collapsible navigation
- Stacked layouts
- Touch-friendly tap targets (minimum 44px)
- Horizontal scrolling for tables
- Reduced font sizes for better readability

## ♿ Accessibility

- **WCAG 2.1 AA Compliant**: Color contrast ratios meet accessibility standards
- **Keyboard Navigation**: Full keyboard support with visible focus indicators
- **ARIA Labels**: Proper semantic HTML and ARIA attributes
- **Screen Reader Support**: Descriptive labels and live regions for dynamic content
- **Reduced Motion**: Respects `prefers-reduced-motion` system setting

## 🎯 Performance

### Optimizations
- **CSV Caching**: 5-minute cache for frequently accessed sheets
- **Debounced Search**: 300ms debounce on all search inputs
- **Document Fragments**: Batch DOM updates for faster rendering
- **Parallel Loading**: Simultaneous data fetches where possible
- **Lazy Evaluation**: Compute metrics only when needed

### Load Times
- **Initial Load**: < 2 seconds (with cached data)
- **Filter Changes**: < 100ms
- **Search**: < 50ms (debounced)

## 🔧 Configuration

### Google Sheets Setup
1. Set your Sheet ID in `constants.js`:
```javascript
SHEET_ID: "YOUR_SHEET_ID_HERE"
```

2. Ensure sheets are publicly accessible or properly authenticated

3. Required sheet structure:
   - **Form responses 1**: Jobs and repairs data
   - **Config**: Optional configuration overrides
   - **State ID's**: Mechanic state ID mappings
   - **Manual**: Manual BET and bins overrides

### Payment Rates
Configure payment rates in `constants.js`:
```javascript
const PAYMENT_RATES = {
  PAY_PER_REPAIR: 700,
  REPAIR_RATE: 2500,
  ENGINE_REPLACEMENT_RATE: 15000,
  ENGINE_REPLACEMENT_RATE_BCSO: 12100,
  ENGINE_REIMBURSEMENT: 12000,
  ENGINE_BONUS_LSPD: 1500
};
```

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl/Cmd + 1` | Navigate to Dashboard |
| `Ctrl/Cmd + 2` | Navigate to Payouts |
| `Ctrl/Cmd + 3` | Navigate to Mechanics |
| `Ctrl/Cmd + 4` | Navigate to Bank Records |
| `Ctrl/Cmd + R` | Refresh current page data |

## 🛠️ File Structure

```
kintsugi-dashboard/
├── index.html                  # Dashboard home
├── dashboard-script.js         # Dashboard logic
├── dashboard-style.css         # Dashboard styles
├── shared-styles.css           # Global styles
├── constants.js                # Configuration constants
├── utils.js                    # Utility functions
├── kintsugi-core.js           # Core shared functions
├── Payouts/
│   ├── payouts-index.html
│   ├── payouts-script.js
│   └── payouts-style.css
├── Mechanics/
│   ├── mechanics-index.html
│   ├── mechanics-script.js
│   └── mechanics-style.css
└── Bank_Record/
    ├── bank-index.html
    ├── bank-script.js
    └── bank-style.css
```

## 📊 Data Flow

1. **Data Fetching**: CSV data fetched from Google Sheets
2. **Parsing**: Robust CSV parser handles quotes and special characters
3. **Caching**: Parsed data cached for 5 minutes
4. **Transformation**: Data aggregated and computed for display
5. **Rendering**: Document fragments used for efficient DOM updates
6. **Filtering**: Client-side filtering with debounced search

## 🔒 Security

- **No Sensitive Data**: All data fetched from publicly accessible sheets
- **Client-Side Only**: No server-side processing or storage
- **XSS Prevention**: Proper escaping of user input
- **HTTPS Required**: Ensure deployment uses HTTPS

## 🐛 Error Handling

- **Graceful Degradation**: Continue operation even if optional data fails to load
- **User-Friendly Messages**: Clear error messages with actionable guidance
- **Retry Mechanisms**: Automatic retry with exponential backoff
- **Error Logging**: Console logging for debugging

## 📈 Future Enhancements

- [ ] Data visualization with charts
- [ ] Advanced analytics and reporting
- [ ] Bulk data import/export
- [ ] Real-time collaboration features
- [ ] Mobile native app
- [ ] Offline support with service workers
- [ ] Advanced search with fuzzy matching
- [ ] Automated report scheduling
- [ ] Multi-language support

## 🤝 Contributing

This is a private business application. For issues or enhancement requests, please contact the development team.

## 📄 License

Proprietary - All rights reserved.

## 💻 Browser Support

- Chrome/Edge (latest)
- Firefox (latest)
- Safari (latest)
- Mobile browsers (iOS Safari, Chrome Mobile)

**Note**: Internet Explorer is not supported.

## 🔄 Version History

See [CHANGELOG.md](CHANGELOG.md) for detailed version history.

## 📞 Support

For technical support or questions:
- Check [IMPLEMENTATION_NOTES.md](IMPLEMENTATION_NOTES.md) for technical details
- Review error messages in the browser console
- Verify Google Sheets sharing settings
- Ensure all required columns are present in sheets

---

**Built with ❤️ for Kintsugi Motorworks**
