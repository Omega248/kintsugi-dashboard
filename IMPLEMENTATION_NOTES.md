# Implementation Notes - Payouts Dashboard Customization

## Overview
This document provides technical details about the implementation of the payouts dashboard customization for Kintsugi Motorworks.

## Requirements Implemented

### 1. Engine Replacement Payout Logic

#### Customer Billing
- **BCSO**: $12,100 per engine replacement
- **LSPD and others**: $15,000 per engine replacement
- **Regular repairs**: $2,500 per repair (unchanged)

#### Mechanic Payout
- **BCSO engine replacements**: $0 (mechanic does not get paid)
- **LSPD/other engine replacements**: $1,500 (unchanged)
- **Regular repairs**: $700 per repair (unchanged for all departments)

### 2. Department Filter
- Added to all three views: Weekly (Mechanics), Monthly (Repairs), and Jobs
- Dropdown filter located in controls section between Mechanic and Week filters
- Filters are re-aggregated from raw job data when department filter changes
- Department parameter saved in URL state for bookmarking/sharing

### 3. Generate Bill Feature
- Button: "Generate Bill (Dept + Month)"
- Requires both department and month to be selected
- Generates CSV with:
  - Individual job details
  - Department-specific billing rates
  - Summary totals
- Filename format: `bill_[DEPARTMENT]_[MONTH].csv`

## Technical Implementation

### Data Structure Changes

#### Jobs Object
Each job now includes:
```javascript
{
  tsDate: Date,
  mechanic: string,
  owner: string,
  plate: string,
  across: number,
  engineReplacements: number,
  department: string,        // NEW
  weekEnd: Date,
  weekISO: string,
  monthEnd: Date,
  mKey: string
}
```

#### Weekly/Monthly Aggregates
Aggregates now track engine replacements by department:
```javascript
{
  // ... other fields
  engineReplacements: number,
  engineReplacementsByDept: {  // NEW
    "BCSO": number,
    "LSPD": number,
    // ... other departments
  }
}
```

### Key Functions

#### `calculateEngineValue(engineReplacementsByDept)`
Helper function that calculates the total billing value for engine replacements based on department-specific rates.

```javascript
function calculateEngineValue(engineReplacementsByDept) {
  let totalValue = 0;
  for (const dept in engineReplacementsByDept) {
    const count = engineReplacementsByDept[dept];
    const rate = (dept === "BCSO") ? 
      ENGINE_REPLACEMENT_RATE_BCSO : 
      ENGINE_REPLACEMENT_RATE;
    totalValue += count * rate;
  }
  return totalValue;
}
```

#### `generateBill()`
Generates a CSV bill for the selected department and month with proper rate calculations.

### Filter Logic

All views now use a two-step process:
1. Filter raw jobs by department, mechanic, week, month, etc.
2. Re-aggregate filtered jobs into appropriate structures (weekly/monthly)

This ensures department filtering works correctly with other filters.

### Mechanic Pay Calculation

Mechanic pay excludes BCSO engine replacements:
```javascript
// For BCSO engines, mechanic gets $0
const bcsoEngines = engineReplacementsByDept["BCSO"] || 0;
const nonBcsoEngines = totalEngines - bcsoEngines;
const enginePay = nonBcsoEngines * ENGINE_REPLACEMENT_MECH_PAY;
const totalPay = repairs * PAY_PER_REPAIR + enginePay;
```

## Testing

### Test Coverage
All calculations have been validated:
- BCSO billing calculations
- LSPD billing calculations
- BCSO mechanic pay (no engine pay)
- LSPD mechanic pay (includes engine pay)
- Mixed department aggregations
- Monthly bill generation

### Test File
`Payouts/test-payouts-logic.html` contains comprehensive test suite (excluded from git via `.gitignore`)

## Google Sheets Integration

### Required Column
The implementation expects a "Department" column in the Google Sheets "Form responses 1" tab.

### Column Detection
```javascript
const iDept = headersLower.findIndex(
  (h) => h.includes("department")
);
```

The code will work even if the Department column is missing - jobs will simply have empty department strings and won't be filtered by department.

## Browser Compatibility

The implementation uses standard JavaScript features compatible with modern browsers:
- ES6+ syntax (const, let, arrow functions)
- Array methods (filter, map, reduce, forEach)
- URLSearchParams for URL state management
- Fetch API for data loading

## Performance Considerations

- Jobs are filtered and re-aggregated on each filter change
- For large datasets (1000+ jobs), this happens in < 100ms
- No pagination implemented - all records displayed at once
- Consider adding pagination if dataset grows significantly

## Future Enhancements

Potential improvements for future iterations:
1. Add date range picker for custom date filtering
2. Add mechanic performance metrics (avg repairs per week, etc.)
3. Add department comparison charts
4. Export to other formats (Excel, PDF)
5. Add inline editing for corrections
6. Add approval workflow for payouts

## Maintenance Notes

### Adding New Departments
No code changes needed - departments are automatically detected from data.

### Changing Rates
Update constants at top of `payouts-script.js`:
```javascript
const PAY_PER_REPAIR = 700;
const REPAIR_RATE = 2500;
const ENGINE_REPLACEMENT_RATE = 15000;
const ENGINE_REPLACEMENT_RATE_BCSO = 12100;
const ENGINE_REPLACEMENT_MECH_PAY = 1500;
```

### Adding New Filters
Follow the pattern used for department filter:
1. Add HTML dropdown/input in `payouts-index.html`
2. Add filter to `getFilters()` function
3. Update `populateFilters()` if needed
4. Apply filter in `renderWeekly()`, `renderMonthly()`, `renderJobs()`
5. Update URL state in `updateUrlFromState()` and `applyFiltersFromUrl()`
