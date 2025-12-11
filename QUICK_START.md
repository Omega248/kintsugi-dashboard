# Kintsugi Dashboard - Quick Start Guide

## 🚀 Getting Started

### Opening the Dashboard
1. Navigate to your deployed dashboard URL or open `index.html` locally
2. The dashboard automatically loads data from Google Sheets
3. Use the navigation tabs to switch between pages: Dashboard, Payouts, Mechanics, Bank

---

## 📋 Using the Payout Summary Generator

### Quick Steps
1. Go to **Payouts** page
2. Select a **specific mechanic** from the "Mechanic" dropdown
3. (Optional) Filter by week or date range
4. Click **"📋 Copy Payout Summary"** button
5. Paste the formatted summary into your bank transaction comment

### What Gets Copied
```
═══════════════════════════════════════
  KINTSUGI MOTORWORKS - PAYOUT SUMMARY
═══════════════════════════════════════

Mechanic: John Smith
State ID: 12345

Period: 1/15/2024 - 1/21/2024
Week #: 3

───────────────────────────────────────
REPAIRS
───────────────────────────────────────
Total Repairs: 25
Engine Replacements: 2
Engine Reimbursement: $24,000

───────────────────────────────────────
PAYOUT
───────────────────────────────────────
Total Payout: $41,500

═══════════════════════════════════════
Generated: 1/22/2024 3:45 PM
```

### Tips
- ✅ **Select a mechanic first** - Button won't work with "All Mechanics"
- ✅ Filter by week for single-week summaries
- ✅ Leave filters at "All" for lifetime totals
- ✅ Toast notification confirms successful copy

---

## 🔍 Running a Payout Audit

### When to Use
- Before processing batch payouts
- To identify missing or duplicate payments
- When reconciling bank records
- Monthly/quarterly financial reviews

### How to Run (via JavaScript Console)
```javascript
// In browser console on Payouts page:
const audit = kAuditPayouts(mechanics, bankRecords);
console.log('Audit Results:', audit);

// View visual audit report:
const auditView = new PayoutAuditView('auditContainer');
auditView.runAuaudit(mechanics, bankRecords);
```

### What It Checks
- ✅ Total expected vs total paid
- ✅ Missing payouts for mechanics
- ✅ Duplicate transactions
- ✅ Zero repairs but expecting payment
- ✅ Missing State IDs

---

## 🏷️ Using Filters

### Quick Filters (Payouts Page)
Click preset buttons for common date ranges:
- **This Week** - Current week's data
- **Last Week** - Previous week
- **This Month** - Current month
- **Last Month** - Previous month

### Active Filter Chips
- **View active filters** - Shown as chips above the table
- **Remove filter** - Click the "×" on any chip
- **Clear all** - Click "Clear all" button

### Advanced Filters
1. Click **"Advanced Filters ▾"** button
2. Enter search criteria (owner name, plate number)
3. Filters apply to Jobs view automatically

---

## 📊 Sorting Tables

### How to Sort
1. Look for column headers with the sort indicator (↕)
2. **Click once** - Sort ascending (↑)
3. **Click again** - Sort descending (↓)
4. **Click third time** - Return to default order

### Visual Feedback
- Sorted column highlighted in **gold**
- Arrow indicates direction (↑ or ↓)
- Smooth animation on sort

---

## 🔎 Searching Data

### Search Box
- Type to search across multiple fields
- Supports typo tolerance (fuzzy matching)
- Results update as you type (debounced)

### Search Tips
- Works across mechanic, owner, plate fields
- Case-insensitive
- Partial matches work
- Clear search box to show all results

---

## 💡 Pro Tips

### Keyboard Shortcuts (Coming Soon)
- `Ctrl+/` - Help menu
- `Ctrl+F` - Focus search
- `Escape` - Close modals

### Exporting Data
1. Apply filters to narrow down data
2. Click **"Export CSV (current view)"**
3. Opens in Excel/Sheets with filtered data only

### Browser Compatibility
- ✅ Chrome 90+ (Recommended)
- ✅ Firefox 88+
- ✅ Safari 14+
- ✅ Edge 90+

### Performance Tips
- Use filters to reduce visible data
- Clear search when viewing all records
- Export large datasets to CSV for external analysis

---

## 🎨 Visual Customization

### Settings Panel
Click the **⚙️ settings button** (bottom right) to access:
- **Compact Mode** - Reduce spacing
- **Show Balance** - Display running balance
- **Show Tax Info** - Show tax columns
- **Items Per Page** - Control pagination (25/50/100)

### Dark Mode
The dashboard uses a dark theme by default, optimized for:
- Reduced eye strain during long sessions
- Better focus on data
- Premium, modern aesthetic

---

## 🆘 Troubleshooting

### Data Not Loading
**Problem**: Tables show "Loading..." indefinitely

**Solutions**:
1. Check Google Sheets permissions - must be shared publicly or with your account
2. Verify sheet ID in configuration
3. Check browser console for errors (F12)
4. Try refreshing the page (Ctrl+R)

### Copy Button Not Working
**Problem**: "Copy Payout Summary" doesn't copy

**Solutions**:
1. Ensure a **specific mechanic** is selected (not "All Mechanics")
2. Check that data has loaded
3. Try using HTTPS instead of HTTP
4. Grant clipboard permissions if prompted

### Filters Not Working
**Problem**: Filters don't seem to apply

**Solutions**:
1. Check that filter chips appear above table
2. Try clearing all filters and reapplying
3. Refresh the page
4. Check browser console for errors

### Slow Performance
**Problem**: Dashboard feels sluggish

**Solutions**:
1. Use filters to reduce visible data
2. Clear browser cache (Ctrl+Shift+Delete)
3. Close other browser tabs
4. Export large datasets to CSV for analysis

---

## 📞 Support

### Getting Help
1. Check **FEATURES.md** for detailed documentation
2. Review **CHANGELOG.md** for recent changes
3. Check browser console for error messages
4. Report issues with specific steps to reproduce

### Debug Mode
Add `?debug=true` to URL for verbose logging:
```
http://your-dashboard.com/Payouts/payouts-index.html?debug=true
```

---

## 🎓 Learning More

### Documentation Files
- **FEATURES.md** - Comprehensive feature guide with API docs
- **CHANGELOG.md** - Version history and detailed changes
- **QUICK_START.md** - This file - quick reference

### Code Examples
See **FEATURES.md** for complete code examples of:
- Using utilities in custom scripts
- Creating custom filters
- Extending components
- Building custom audit rules

---

## ✨ What's New in v2.0

### Visual Enhancements
- 🏆 Kintsugi gold branding throughout
- ✨ Smooth animations and transitions
- 🎨 Unified design system
- 📊 Enhanced table styling

### New Features
- 📋 Payout summary generator
- 🔍 Payout audit system
- 🏷️ Filter chips component
- 📊 Sortable tables
- 🔎 Enhanced search

### Under the Hood
- 🛠️ 25+ new utility functions
- 📚 Comprehensive documentation
- 🔒 Security hardening
- ⚡ Performance improvements

---

**Happy tracking! 🚀**

*Last updated: January 2024*
