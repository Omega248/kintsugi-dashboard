/**
 * Data Aggregation Utilities
 * Helper functions for aggregating and analyzing data
 */

const Aggregations = {
  /**
   * Calculate total revenue
   */
  totalRevenue(orders) {
    return orders.reduce((sum, order) => sum + (order.total || 0), 0);
  },

  /**
   * Calculate total payouts
   */
  totalPayouts(payouts) {
    return payouts.reduce((sum, payout) => sum + (payout.amount || 0), 0);
  },

  /**
   * Group orders by category
   */
  byCategory(orders) {
    const groups = {};
    
    orders.forEach(order => {
      const category = order.category || 'other';
      if (!groups[category]) {
        groups[category] = [];
      }
      groups[category].push(order);
    });

    return groups;
  },

  /**
   * Group by staff member
   */
  byStaff(orders) {
    const groups = {};
    
    orders.forEach(order => {
      const staff = order.staff || 'Unassigned';
      if (!groups[staff]) {
        groups[staff] = [];
      }
      groups[staff].push(order);
    });

    return groups;
  },

  /**
   * Group payouts by person
   */
  payoutsByPerson(payouts) {
    const groups = {};
    
    payouts.forEach(payout => {
      const person = payout.person || 'Unknown';
      if (!groups[person]) {
        groups[person] = {
          person,
          earnings: 0,
          reimbursements: 0,
          bonuses: 0,
          total: 0,
          payouts: []
        };
      }

      groups[person].payouts.push(payout);
      groups[person].total += payout.amount || 0;

      // Categorize by type
      if (payout.type === 'earning') {
        groups[person].earnings += payout.amount || 0;
      } else if (payout.type === 'reimbursement') {
        groups[person].reimbursements += payout.amount || 0;
      } else if (payout.type === 'bonus') {
        groups[person].bonuses += payout.amount || 0;
      }
    });

    return groups;
  },

  /**
   * Group payouts by week
   */
  payoutsByWeek(payouts) {
    const groups = {};
    
    payouts.forEach(payout => {
      if (!payout.week) return;

      const weekKey = payout.week.toISOString().split('T')[0];
      if (!groups[weekKey]) {
        groups[weekKey] = {
          week: payout.week,
          payouts: [],
          total: 0
        };
      }

      groups[weekKey].payouts.push(payout);
      groups[weekKey].total += payout.amount || 0;
    });

    return groups;
  },

  /**
   * Calculate staff metrics
   */
  staffMetrics(staff, orders, payouts) {
    return staff.map(member => {
      const memberOrders = orders.filter(o => o.staff === member.name);
      const memberPayouts = payouts.filter(p => p.person === member.name);

      const totalOrders = memberOrders.length;
      const totalRevenue = this.totalRevenue(memberOrders);
      const totalPayouts = this.totalPayouts(memberPayouts);
      const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

      return {
        ...member,
        metrics: {
          totalOrders,
          totalRevenue,
          totalPayouts,
          avgOrderValue
        }
      };
    });
  },

  /**
   * Calculate trend vs previous period
   */
  calculateTrend(currentValue, previousValue) {
    if (!previousValue || previousValue === 0) {
      return {
        direction: 'neutral',
        value: 0,
        label: 'N/A'
      };
    }

    const change = ((currentValue - previousValue) / previousValue) * 100;
    
    return {
      direction: change > 0 ? 'up' : change < 0 ? 'down' : 'neutral',
      value: Math.abs(change),
      label: 'vs prev period'
    };
  },

  /**
   * Get top performers
   */
  topPerformers(staffMetrics, metric = 'totalRevenue', limit = 5) {
    return staffMetrics
      .sort((a, b) => (b.metrics[metric] || 0) - (a.metrics[metric] || 0))
      .slice(0, limit);
  },

  /**
   * Get subsidiary summary
   */
  subsidiarySummary(orders, payouts, staff, subsidiary) {
    const subOrders = orders.filter(o => o.subsidiary === subsidiary);
    const subPayouts = payouts.filter(p => p.subsidiary === subsidiary);
    const subStaff = staff.filter(s => s.subsidiary === subsidiary);

    return {
      subsidiary,
      totalOrders: subOrders.length,
      totalRevenue: this.totalRevenue(subOrders),
      totalPayouts: this.totalPayouts(subPayouts),
      activeStaff: subStaff.filter(s => s.active).length,
      avgOrderValue: subOrders.length > 0 
        ? this.totalRevenue(subOrders) / subOrders.length 
        : 0
    };
  },

  /**
   * Identify alerts
   */
  identifyAlerts(staff, payouts) {
    const alerts = [];

    // Missing state IDs
    const missingStateIds = staff.filter(s => s.active && !s.hasStateId());
    if (missingStateIds.length > 0) {
      alerts.push({
        type: 'warning',
        title: 'Missing State IDs',
        message: `${missingStateIds.length} staff member(s) missing state ID`,
        data: missingStateIds
      });
    }

    // Unassigned staff (no payouts)
    const payoutPersons = new Set(payouts.map(p => p.person));
    const unassignedStaff = staff.filter(s => s.active && !payoutPersons.has(s.name));
    if (unassignedStaff.length > 0) {
      alerts.push({
        type: 'info',
        title: 'Staff Without Payouts',
        message: `${unassignedStaff.length} active staff member(s) have no payouts`,
        data: unassignedStaff
      });
    }

    return alerts;
  },

  /**
   * Generate executive summary text
   */
  generateExecutiveSummary(data) {
    const { orders, payouts, staff } = data;
    
    const kintsugiSummary = this.subsidiarySummary(orders, payouts, staff, 'kintsugi');
    const takosuyaSummary = this.subsidiarySummary(orders, payouts, staff, 'takosuya');
    
    const totalRevenue = kintsugiSummary.totalRevenue + takosuyaSummary.totalRevenue;
    const totalOrders = kintsugiSummary.totalOrders + takosuyaSummary.totalOrders;
    const totalPayouts = kintsugiSummary.totalPayouts + takosuyaSummary.totalPayouts;
    const totalStaff = kintsugiSummary.activeStaff + takosuyaSummary.activeStaff;

    return `
KANESHIRO ENTERPRISES - EXECUTIVE SUMMARY

CONSOLIDATED PERFORMANCE:
• Total Revenue: $${totalRevenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
• Total Orders: ${totalOrders.toLocaleString('en-US')}
• Total Payouts: $${totalPayouts.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
• Active Staff: ${totalStaff}

KINTSUGI:
• Revenue: $${kintsugiSummary.totalRevenue.toLocaleString('en-US', { minimumFractionDigits: 2 })}
• Orders: ${kintsugiSummary.totalOrders}
• Avg Order: $${kintsugiSummary.avgOrderValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}
• Staff: ${kintsugiSummary.activeStaff}

TAKOSUYA:
• Revenue: $${takosuyaSummary.totalRevenue.toLocaleString('en-US', { minimumFractionDigits: 2 })}
• Orders: ${takosuyaSummary.totalOrders}
• Avg Order: $${takosuyaSummary.avgOrderValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}
• Staff: ${takosuyaSummary.activeStaff}
    `.trim();
  }
};

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Aggregations;
}
