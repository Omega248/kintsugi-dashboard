# Changelog

## Payouts Dashboard Customization (December 2024)

### Engine Replacement Payout Logic Updates

#### Customer Billing Rates
- **BCSO**: Engine replacements now billed at **$12,100** (previously $15,000)
- **LSPD**: Engine replacements remain at **$15,000**
- **All other repairs**: Continue at $2,500 per repair (across)

#### Mechanic Payout Changes
- **BCSO Engine Replacements**: Mechanics receive **$0** for BCSO engine replacements
- **LSPD Engine Replacements**: Mechanics receive **$1,500** per engine replacement (unchanged)
- **Regular Repairs**: All mechanics receive **$700** per repair across all departments (unchanged)

### Department Filter

A new **Department** filter has been added to the payouts dashboard, enabling:
- Filtering by specific department (BCSO, LSPD, etc.) in all views
- Department-specific reporting and analysis
- Combined filtering with existing mechanic, week, and month filters

The department filter applies to:
- **Weekly View**: Shows mechanic payouts filtered by department
- **Monthly View**: Shows repair totals and values filtered by department
- **Jobs View**: Shows individual jobs filtered by department

### Generate Bill Feature

A new **"Generate Bill (Dept + Month)"** button has been added that:
- Requires both a department and month to be selected
- Generates a CSV bill with:
  - Individual job details (date, mechanic, owner, plate)
  - Repair counts and values
  - Engine replacement counts and values (using department-specific rates)
  - Summary totals
- Filename format: `bill_[DEPARTMENT]_[MONTH-DATE].csv`

### Implementation Details

#### Code Changes
1. Added `ENGINE_REPLACEMENT_RATE_BCSO = 12100` constant
2. Added department column parsing from Google Sheets
3. Modified aggregation logic to track engine replacements by department
4. Updated payout calculations to exclude BCSO engine replacements from mechanic pay
5. Updated billing calculations to use BCSO rate for BCSO engine replacements
6. Added department filter UI element and event handlers
7. Implemented `generateBill()` function for CSV bill generation

#### Data Structure
Jobs now include a `department` field, and weekly/monthly aggregates include an `engineReplacementsByDept` object that tracks engine replacements by department for proper rate calculation.

### Testing

All logic has been tested and verified:
- ✅ BCSO engine replacements billed at $12,100
- ✅ LSPD engine replacements billed at $15,000
- ✅ Mechanics receive $0 for BCSO engine replacements
- ✅ Mechanics receive $1,500 for LSPD engine replacements
- ✅ Mixed department calculations work correctly
- ✅ Department filter works in all views
- ✅ Bill generation produces correct totals

### Screenshots

UI with Department Filter:
![Payouts Dashboard](https://github.com/user-attachments/assets/ea4f4a1b-b1c2-46d3-b949-40a82ef67e3f)

Test Results:
![Test Results](https://github.com/user-attachments/assets/c78f5cb5-a485-4fd5-bc0b-13ac41afe3df)
