// =======================================
// Data Aggregation Utilities
// Reusable aggregation functions for mechanic data, payouts, and statistics
// =======================================

/**
 * Aggregate jobs by mechanic and week
 * @param {Array} jobs - Array of job objects
 * @param {Object} [options] - Aggregation options
 * @param {Function} [options.filter] - Optional filter function for jobs
 * @returns {Map} Map of mechanic|weekISO -> aggregate data
 */
function aggregateByMechanicWeek(jobs, options = {}) {
  const { filter } = options;
  const weeklyMap = new Map();
  
  const jobsToProcess = filter ? jobs.filter(filter) : jobs;
  
  jobsToProcess.forEach((job) => {
    const key = `${job.mechanic}|${job.weekISO}`;
    const existing = weeklyMap.get(key) || {
      mechanic: job.mechanic,
      weekEnd: job.weekEnd,
      weekISO: job.weekISO,
      repairs: 0,
      engineReplacements: 0,
      engineReplacementsByDept: {},
      jobs: []
    };
    
    existing.repairs += job.across || 0;
    existing.engineReplacements += job.engineReplacements || 0;
    
    if (job.engineReplacements > 0 && job.department) {
      existing.engineReplacementsByDept[job.department] = 
        (existing.engineReplacementsByDept[job.department] || 0) + job.engineReplacements;
    }
    
    existing.jobs.push(job);
    weeklyMap.set(key, existing);
  });
  
  return weeklyMap;
}

/**
 * Aggregate jobs by month
 * @param {Array} jobs - Array of job objects
 * @param {Object} [options] - Aggregation options
 * @param {Function} [options.filter] - Optional filter function for jobs
 * @returns {Map} Map of monthKey -> aggregate data
 */
function aggregateByMonth(jobs, options = {}) {
  const { filter } = options;
  const monthlyMap = new Map();
  
  const jobsToProcess = filter ? jobs.filter(filter) : jobs;
  
  jobsToProcess.forEach((job) => {
    const key = job.mKey;
    const existing = monthlyMap.get(key) || {
      monthEnd: job.monthEnd,
      mKey: job.mKey,
      repairs: 0,
      engineReplacements: 0,
      engineReplacementsByDept: {},
      jobs: []
    };
    
    existing.repairs += job.across || 0;
    existing.engineReplacements += job.engineReplacements || 0;
    
    if (job.engineReplacements > 0 && job.department) {
      existing.engineReplacementsByDept[job.department] = 
        (existing.engineReplacementsByDept[job.department] || 0) + job.engineReplacements;
    }
    
    existing.jobs.push(job);
    monthlyMap.set(key, existing);
  });
  
  return monthlyMap;
}

/**
 * Aggregate jobs by mechanic (all time)
 * @param {Array} jobs - Array of job objects
 * @param {Object} [options] - Aggregation options
 * @param {Function} [options.filter] - Optional filter function for jobs
 * @returns {Map} Map of mechanic -> aggregate data
 */
function aggregateByMechanic(jobs, options = {}) {
  const { filter } = options;
  const mechanicMap = new Map();
  
  const jobsToProcess = filter ? jobs.filter(filter) : jobs;
  
  jobsToProcess.forEach((job) => {
    const existing = mechanicMap.get(job.mechanic) || {
      mechanic: job.mechanic,
      totalRepairs: 0,
      totalEngines: 0,
      enginesByDept: {},
      weeksWorked: new Set(),
      monthsActive: new Set(),
      firstJob: null,
      lastJob: null,
      jobs: []
    };
    
    existing.totalRepairs += job.across || 0;
    existing.totalEngines += job.engineReplacements || 0;
    
    if (job.engineReplacements > 0 && job.department) {
      existing.enginesByDept[job.department] = 
        (existing.enginesByDept[job.department] || 0) + job.engineReplacements;
    }
    
    if (job.weekISO) existing.weeksWorked.add(job.weekISO);
    if (job.mKey) existing.monthsActive.add(job.mKey);
    
    // Track first and last job dates
    if (job.tsDate) {
      if (!existing.firstJob || job.tsDate < existing.firstJob) {
        existing.firstJob = job.tsDate;
      }
      if (!existing.lastJob || job.tsDate > existing.lastJob) {
        existing.lastJob = job.tsDate;
      }
    }
    
    existing.jobs.push(job);
    mechanicMap.set(job.mechanic, existing);
  });
  
  return mechanicMap;
}

/**
 * Aggregate jobs by department
 * @param {Array} jobs - Array of job objects
 * @param {Object} [options] - Aggregation options
 * @returns {Map} Map of department -> aggregate data
 */
function aggregateByDepartment(jobs, options = {}) {
  const deptMap = new Map();
  
  jobs.forEach((job) => {
    const dept = job.department || 'Unknown';
    const existing = deptMap.get(dept) || {
      department: dept,
      totalRepairs: 0,
      totalEngines: 0,
      jobs: []
    };
    
    existing.totalRepairs += job.across || 0;
    existing.totalEngines += job.engineReplacements || 0;
    existing.jobs.push(job);
    
    deptMap.set(dept, existing);
  });
  
  return deptMap;
}

/**
 * Calculate mechanic statistics
 * @param {Array} jobs - Jobs for a specific mechanic
 * @param {Object} [rates] - Payment rates
 * @returns {Object} Statistics object
 */
function calculateMechanicStats(jobs, rates = {}) {
  const {
    payPerRepair = 700,
    engineReimbursement = 12000,
    engineBonus = 1500
  } = rates;
  
  const stats = {
    totalRepairs: 0,
    totalEngines: 0,
    enginesByDept: {},
    weeksWorked: new Set(),
    monthsActive: new Set(),
    firstJob: null,
    lastJob: null,
    totalPay: 0,
    repairPay: 0,
    enginePay: 0
  };
  
  jobs.forEach((job) => {
    stats.totalRepairs += job.across || 0;
    stats.totalEngines += job.engineReplacements || 0;
    
    if (job.engineReplacements > 0 && job.department) {
      stats.enginesByDept[job.department] = 
        (stats.enginesByDept[job.department] || 0) + job.engineReplacements;
    }
    
    if (job.weekISO) stats.weeksWorked.add(job.weekISO);
    if (job.mKey) stats.monthsActive.add(job.mKey);
    
    if (job.tsDate) {
      if (!stats.firstJob || job.tsDate < stats.firstJob) {
        stats.firstJob = job.tsDate;
      }
      if (!stats.lastJob || job.tsDate > stats.lastJob) {
        stats.lastJob = job.tsDate;
      }
    }
  });
  
  // Calculate pay
  stats.repairPay = stats.totalRepairs * payPerRepair;
  
  // Calculate engine pay by department
  let totalEnginePay = 0;
  for (const [dept, count] of Object.entries(stats.enginesByDept)) {
    if (dept === 'BCSO') {
      // BCSO: reimbursement only
      totalEnginePay += count * engineReimbursement;
    } else {
      // LSPD and others: reimbursement + bonus
      totalEnginePay += count * (engineReimbursement + engineBonus);
    }
  }
  stats.enginePay = totalEnginePay;
  stats.totalPay = stats.repairPay + stats.enginePay;
  
  // Convert Sets to counts
  stats.weeksWorkedCount = stats.weeksWorked.size;
  stats.monthsActiveCount = stats.monthsActive.size;
  
  // Calculate averages
  stats.avgRepairsPerWeek = stats.weeksWorkedCount > 0 
    ? stats.totalRepairs / stats.weeksWorkedCount 
    : 0;
  
  return stats;
}

/**
 * Group jobs by a specific field
 * @param {Array} jobs - Array of job objects
 * @param {string|Function} groupBy - Field name or grouping function
 * @returns {Map} Map of groupKey -> jobs array
 */
function groupJobsBy(jobs, groupBy) {
  const groups = new Map();
  
  jobs.forEach((job) => {
    const key = typeof groupBy === 'function' 
      ? groupBy(job) 
      : job[groupBy];
    
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(job);
  });
  
  return groups;
}

/**
 * Calculate summary statistics for a set of jobs
 * @param {Array} jobs - Array of job objects
 * @param {Object} [rates] - Payment rates
 * @returns {Object} Summary statistics
 */
function calculateSummaryStats(jobs, rates = {}) {
  const {
    payPerRepair = 700,
    repairRate = 2500,
    engineReimbursement = 12000,
    engineBonus = 1500,
    engineRate = 15000,
    engineRateBCSO = 12100
  } = rates;
  
  const summary = {
    totalJobs: jobs.length,
    totalRepairs: 0,
    totalEngines: 0,
    enginesByDept: {},
    uniqueMechanics: new Set(),
    uniqueWeeks: new Set(),
    uniqueMonths: new Set(),
    totalMechanicPay: 0,
    totalCustomerBilling: 0,
    dateRange: {
      first: null,
      last: null
    }
  };
  
  jobs.forEach((job) => {
    // Count repairs and engines
    summary.totalRepairs += job.across || 0;
    summary.totalEngines += job.engineReplacements || 0;
    
    // Track engines by department
    if (job.engineReplacements > 0 && job.department) {
      summary.enginesByDept[job.department] = 
        (summary.enginesByDept[job.department] || 0) + job.engineReplacements;
    }
    
    // Track unique values
    if (job.mechanic) summary.uniqueMechanics.add(job.mechanic);
    if (job.weekISO) summary.uniqueWeeks.add(job.weekISO);
    if (job.mKey) summary.uniqueMonths.add(job.mKey);
    
    // Track date range
    if (job.tsDate) {
      if (!summary.dateRange.first || job.tsDate < summary.dateRange.first) {
        summary.dateRange.first = job.tsDate;
      }
      if (!summary.dateRange.last || job.tsDate > summary.dateRange.last) {
        summary.dateRange.last = job.tsDate;
      }
    }
    
    // Calculate mechanic pay for this job
    const repairPay = (job.across || 0) * payPerRepair;
    let enginePay = 0;
    
    if (job.engineReplacements > 0) {
      if (job.department === 'BCSO') {
        enginePay = job.engineReplacements * engineReimbursement;
      } else {
        enginePay = job.engineReplacements * (engineReimbursement + engineBonus);
      }
    }
    
    summary.totalMechanicPay += repairPay + enginePay;
    
    // Calculate customer billing for this job
    const repairBilling = (job.across || 0) * repairRate;
    let engineBilling = 0;
    
    if (job.engineReplacements > 0) {
      const rate = job.department === 'BCSO' ? engineRateBCSO : engineRate;
      engineBilling = job.engineReplacements * rate;
    }
    
    summary.totalCustomerBilling += repairBilling + engineBilling;
  });
  
  // Convert Sets to counts
  summary.uniqueMechanicsCount = summary.uniqueMechanics.size;
  summary.uniqueWeeksCount = summary.uniqueWeeks.size;
  summary.uniqueMonthsCount = summary.uniqueMonths.size;
  
  // Calculate averages
  summary.avgRepairsPerJob = summary.totalJobs > 0 
    ? summary.totalRepairs / summary.totalJobs 
    : 0;
  
  summary.avgJobsPerMechanic = summary.uniqueMechanicsCount > 0 
    ? summary.totalJobs / summary.uniqueMechanicsCount 
    : 0;
  
  summary.avgPayPerJob = summary.totalJobs > 0 
    ? summary.totalMechanicPay / summary.totalJobs 
    : 0;
  
  return summary;
}

/**
 * Filter jobs by date range
 * @param {Array} jobs - Array of job objects
 * @param {Date} startDate - Start date (inclusive)
 * @param {Date} endDate - End date (inclusive)
 * @returns {Array} Filtered jobs
 */
function filterJobsByDateRange(jobs, startDate, endDate) {
  return jobs.filter((job) => {
    if (!job.tsDate) return false;
    return job.tsDate >= startDate && job.tsDate <= endDate;
  });
}

/**
 * Filter jobs by time period
 * @param {Array} jobs - Array of job objects
 * @param {string} period - Period: 'last4w', 'last3m', 'last6m', 'last12m', 'thisMonth', 'thisYear'
 * @returns {Array} Filtered jobs
 */
function filterJobsByPeriod(jobs, period) {
  const now = new Date();
  let startDate = new Date(0); // Beginning of time as default
  
  switch (period) {
    case 'last4w':
      startDate = new Date(now);
      startDate.setDate(now.getDate() - 28);
      break;
    case 'last3m':
      startDate = new Date(now);
      startDate.setMonth(now.getMonth() - 3);
      break;
    case 'last6m':
      startDate = new Date(now);
      startDate.setMonth(now.getMonth() - 6);
      break;
    case 'last12m':
      startDate = new Date(now);
      startDate.setFullYear(now.getFullYear() - 1);
      break;
    case 'thisMonth':
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      break;
    case 'thisYear':
      startDate = new Date(now.getFullYear(), 0, 1);
      break;
    case 'all':
    default:
      return jobs;
  }
  
  return filterJobsByDateRange(jobs, startDate, now);
}

/**
 * Sort aggregated data by field
 * @param {Array} data - Array of aggregate objects
 * @param {string} sortBy - Field to sort by
 * @param {string} [order='desc'] - Sort order: 'asc' or 'desc'
 * @returns {Array} Sorted array
 */
function sortAggregatedData(data, sortBy, order = 'desc') {
  const sorted = [...data].sort((a, b) => {
    let aVal, bVal;
    
    switch (sortBy) {
      case 'name':
      case 'mechanic':
        aVal = a.mechanic || '';
        bVal = b.mechanic || '';
        return order === 'asc' 
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
      
      case 'totalRepairs':
        aVal = a.totalRepairs || a.repairs || 0;
        bVal = b.totalRepairs || b.repairs || 0;
        break;
      
      case 'weeksWorked':
        aVal = a.weeksWorkedCount || (a.weeksWorked ? a.weeksWorked.size : 0);
        bVal = b.weeksWorkedCount || (b.weeksWorked ? b.weeksWorked.size : 0);
        break;
      
      case 'avgPerWeek':
        aVal = a.avgRepairsPerWeek || 0;
        bVal = b.avgRepairsPerWeek || 0;
        break;
      
      case 'lifetimePayout':
      case 'totalPay':
        aVal = a.totalPay || 0;
        bVal = b.totalPay || 0;
        break;
      
      default:
        aVal = a[sortBy] || 0;
        bVal = b[sortBy] || 0;
    }
    
    if (order === 'asc') {
      return aVal > bVal ? 1 : aVal < bVal ? -1 : 0;
    } else {
      return aVal < bVal ? 1 : aVal > bVal ? -1 : 0;
    }
  });
  
  return sorted;
}

/**
 * Get top performers by metric
 * @param {Map} mechanicMap - Map of mechanic data
 * @param {string} metric - Metric to rank by: 'repairs', 'pay', 'avgPerWeek'
 * @param {number} [limit=10] - Number of top performers to return
 * @returns {Array} Top performers
 */
function getTopPerformers(mechanicMap, metric, limit = 10) {
  const mechanics = Array.from(mechanicMap.values());
  
  let sortField = 'totalRepairs';
  if (metric === 'pay') sortField = 'totalPay';
  if (metric === 'avgPerWeek') sortField = 'avgRepairsPerWeek';
  
  const sorted = sortAggregatedData(mechanics, sortField, 'desc');
  return sorted.slice(0, limit);
}
