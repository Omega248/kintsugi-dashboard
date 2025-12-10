// =======================================
// UI Components
// Reusable UI component builders for consistent interface elements
// =======================================

/**
 * Create a loading skeleton element
 * @param {string} [type='text'] - Skeleton type: 'text', 'title', 'avatar', 'card', 'table'
 * @param {Object} [options] - Customization options
 * @returns {HTMLElement} Skeleton element
 */
function createSkeleton(type = 'text', options = {}) {
  const {
    width = '100%',
    height = type === 'text' ? '1em' : type === 'title' ? '1.5em' : '48px',
    count = 1
  } = options;
  
  if (count > 1) {
    const container = document.createElement('div');
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.gap = 'var(--space-sm, 8px)';
    
    for (let i = 0; i < count; i++) {
      container.appendChild(createSkeleton(type, { ...options, count: 1 }));
    }
    
    return container;
  }
  
  const skeleton = document.createElement('div');
  skeleton.className = `skeleton skeleton-${type}`;
  
  Object.assign(skeleton.style, {
    width,
    height,
    background: 'linear-gradient(90deg, var(--bg-secondary) 0%, var(--bg-tertiary) 50%, var(--bg-secondary) 100%)',
    backgroundSize: '200% 100%',
    animation: 'kSkeletonPulse 1.5s ease-in-out infinite',
    borderRadius: type === 'avatar' ? '50%' : 'var(--radius-sm, 8px)'
  });
  
  return skeleton;
}

/**
 * Create a badge element
 * @param {string} text - Badge text
 * @param {string} [variant='default'] - Badge variant: 'default', 'success', 'warning', 'error', 'info'
 * @param {Object} [options] - Additional options
 * @returns {HTMLElement} Badge element
 */
function createBadge(text, variant = 'default', options = {}) {
  const { size = 'md', icon = null } = options;
  
  const badge = document.createElement('span');
  badge.className = `badge badge-${variant} badge-${size}`;
  badge.textContent = text;
  
  const colors = {
    default: { bg: 'var(--border-strong)', color: 'var(--text-secondary)' },
    success: { bg: 'var(--color-success)', color: 'white' },
    warning: { bg: 'var(--color-warning)', color: 'black' },
    error: { bg: 'var(--color-error)', color: 'white' },
    info: { bg: 'var(--accent-primary)', color: 'white' }
  };
  
  const sizes = {
    sm: { padding: '2px 8px', fontSize: 'var(--font-size-xs)' },
    md: { padding: '4px 10px', fontSize: 'var(--font-size-sm)' },
    lg: { padding: '6px 12px', fontSize: 'var(--font-size-base)' }
  };
  
  Object.assign(badge.style, {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    backgroundColor: colors[variant].bg,
    color: colors[variant].color,
    borderRadius: 'var(--radius-full, 999px)',
    fontWeight: '500',
    whiteSpace: 'nowrap',
    ...sizes[size]
  });
  
  if (icon) {
    const iconEl = document.createElement('span');
    iconEl.textContent = icon;
    badge.insertBefore(iconEl, badge.firstChild);
  }
  
  return badge;
}

/**
 * Create a progress bar
 * @param {number} value - Progress value (0-100)
 * @param {Object} [options] - Customization options
 * @returns {HTMLElement} Progress bar element
 */
function createProgressBar(value, options = {}) {
  const {
    height = '8px',
    variant = 'primary',
    showLabel = false,
    animated = false
  } = options;
  
  const container = document.createElement('div');
  container.className = 'progress-bar-container';
  
  Object.assign(container.style, {
    width: '100%',
    height,
    backgroundColor: 'var(--bg-tertiary)',
    borderRadius: 'var(--radius-full)',
    overflow: 'hidden',
    position: 'relative'
  });
  
  const bar = document.createElement('div');
  bar.className = 'progress-bar';
  
  const colors = {
    primary: 'var(--accent-primary)',
    success: 'var(--color-success)',
    warning: 'var(--color-warning)',
    error: 'var(--color-error)'
  };
  
  Object.assign(bar.style, {
    width: `${Math.min(100, Math.max(0, value))}%`,
    height: '100%',
    backgroundColor: colors[variant],
    transition: 'width 0.3s ease',
    borderRadius: 'var(--radius-full)'
  });
  
  if (animated) {
    bar.style.animation = 'progressPulse 1.5s ease-in-out infinite';
  }
  
  container.appendChild(bar);
  
  if (showLabel) {
    const label = document.createElement('span');
    label.className = 'progress-label';
    label.textContent = `${Math.round(value)}%`;
    
    Object.assign(label.style, {
      position: 'absolute',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      fontSize: 'var(--font-size-xs)',
      fontWeight: '600',
      color: 'var(--text-primary)',
      textShadow: '0 0 4px rgba(0, 0, 0, 0.8)'
    });
    
    container.appendChild(label);
  }
  
  return container;
}

/**
 * Create an empty state component
 * @param {Object} options - Configuration options
 * @returns {HTMLElement} Empty state element
 */
function createEmptyState(options = {}) {
  const {
    icon = '📭',
    title = 'No data available',
    message = 'There are no items to display.',
    actionText = null,
    actionCallback = null
  } = options;
  
  const container = document.createElement('div');
  container.className = 'empty-state';
  
  Object.assign(container.style, {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 'var(--space-2xl, 48px)',
    textAlign: 'center',
    minHeight: '200px'
  });
  
  const iconEl = document.createElement('div');
  iconEl.className = 'empty-state-icon';
  iconEl.textContent = icon;
  iconEl.style.fontSize = '64px';
  iconEl.style.marginBottom = 'var(--space-md, 16px)';
  iconEl.style.opacity = '0.5';
  
  const titleEl = document.createElement('h3');
  titleEl.className = 'empty-state-title';
  titleEl.textContent = title;
  titleEl.style.margin = '0 0 var(--space-sm, 8px)';
  titleEl.style.color = 'var(--text-primary)';
  titleEl.style.fontSize = 'var(--font-size-lg)';
  
  const messageEl = document.createElement('p');
  messageEl.className = 'empty-state-message';
  messageEl.textContent = message;
  messageEl.style.margin = '0';
  messageEl.style.color = 'var(--text-secondary)';
  messageEl.style.fontSize = 'var(--font-size-base)';
  messageEl.style.maxWidth = '400px';
  messageEl.style.lineHeight = '1.6';
  
  container.appendChild(iconEl);
  container.appendChild(titleEl);
  container.appendChild(messageEl);
  
  if (actionText && actionCallback) {
    const actionBtn = document.createElement('button');
    actionBtn.className = 'btn btn-primary';
    actionBtn.textContent = actionText;
    actionBtn.style.marginTop = 'var(--space-md, 16px)';
    actionBtn.addEventListener('click', actionCallback);
    container.appendChild(actionBtn);
  }
  
  return container;
}

/**
 * Create a stat card component
 * @param {Object} data - Card data
 * @returns {HTMLElement} Stat card element
 */
function createStatCard(data) {
  const {
    title,
    value,
    subtitle = null,
    icon = null,
    trend = null,
    trendLabel = null,
    variant = 'default'
  } = data;
  
  const card = document.createElement('div');
  card.className = 'stat-card';
  
  Object.assign(card.style, {
    padding: 'var(--space-md, 16px)',
    borderRadius: 'var(--radius-lg, 18px)',
    background: 'radial-gradient(circle at top left, rgba(148, 163, 253, 0.10), transparent), rgba(6, 11, 25, 0.98)',
    border: '1px solid var(--border-default)',
    boxShadow: 'var(--shadow-soft)',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-xs, 4px)',
    transition: 'transform var(--transition-base)',
    cursor: 'default'
  });
  
  // Header with title and icon
  const header = document.createElement('div');
  header.style.display = 'flex';
  header.style.justifyContent = 'space-between';
  header.style.alignItems = 'flex-start';
  
  const titleEl = document.createElement('h3');
  titleEl.textContent = title;
  Object.assign(titleEl.style, {
    margin: '0',
    fontSize: 'var(--font-size-sm)',
    textTransform: 'uppercase',
    letterSpacing: '0.18em',
    color: 'var(--text-secondary)',
    fontWeight: '600'
  });
  
  header.appendChild(titleEl);
  
  if (icon) {
    const iconEl = document.createElement('span');
    iconEl.textContent = icon;
    iconEl.style.fontSize = 'var(--font-size-xl)';
    iconEl.style.opacity = '0.7';
    header.appendChild(iconEl);
  }
  
  card.appendChild(header);
  
  // Value
  const valueEl = document.createElement('div');
  valueEl.textContent = value;
  Object.assign(valueEl.style, {
    fontSize: 'var(--font-size-2xl)',
    fontWeight: '600',
    color: 'var(--text-primary)',
    lineHeight: '1.1'
  });
  card.appendChild(valueEl);
  
  // Subtitle or trend
  if (subtitle || trend !== null) {
    const footer = document.createElement('div');
    footer.style.display = 'flex';
    footer.style.alignItems = 'center';
    footer.style.gap = 'var(--space-xs, 4px)';
    footer.style.fontSize = 'var(--font-size-sm)';
    
    if (trend !== null) {
      const trendIcon = trend > 0 ? '↑' : trend < 0 ? '↓' : '→';
      const trendColor = trend > 0 ? 'var(--color-success)' : 
                        trend < 0 ? 'var(--color-error)' : 
                        'var(--text-secondary)';
      
      const trendEl = document.createElement('span');
      trendEl.textContent = `${trendIcon} ${Math.abs(trend)}%`;
      trendEl.style.color = trendColor;
      trendEl.style.fontWeight = '600';
      footer.appendChild(trendEl);
      
      if (trendLabel) {
        const labelEl = document.createElement('span');
        labelEl.textContent = trendLabel;
        labelEl.style.color = 'var(--text-secondary)';
        footer.appendChild(labelEl);
      }
    } else if (subtitle) {
      const subtitleEl = document.createElement('span');
      subtitleEl.textContent = subtitle;
      subtitleEl.style.color = 'var(--text-secondary)';
      footer.appendChild(subtitleEl);
    }
    
    card.appendChild(footer);
  }
  
  // Hover effect
  card.addEventListener('mouseenter', () => {
    card.style.transform = 'translateY(-2px)';
  });
  card.addEventListener('mouseleave', () => {
    card.style.transform = 'translateY(0)';
  });
  
  return card;
}

/**
 * Create a simple spinner element
 * @param {Object} [options] - Customization options
 * @returns {HTMLElement} Spinner element
 */
function createSpinner(options = {}) {
  const {
    size = '40px',
    color = 'var(--accent-primary)',
    thickness = '3px'
  } = options;
  
  const spinner = document.createElement('div');
  spinner.className = 'spinner';
  
  Object.assign(spinner.style, {
    width: size,
    height: size,
    border: `${thickness} solid var(--border-default)`,
    borderTopColor: color,
    borderRadius: '50%',
    animation: 'kSpin 0.8s linear infinite'
  });
  
  return spinner;
}

/**
 * Create a tooltip element
 * @param {HTMLElement} target - Element to attach tooltip to
 * @param {string} content - Tooltip content
 * @param {Object} [options] - Customization options
 */
function createTooltip(target, content, options = {}) {
  const {
    position = 'top',
    delay = 300
  } = options;
  
  let tooltip = null;
  let timeout = null;
  
  const showTooltip = () => {
    timeout = setTimeout(() => {
      tooltip = document.createElement('div');
      tooltip.className = 'tooltip';
      tooltip.textContent = content;
      
      Object.assign(tooltip.style, {
        position: 'absolute',
        padding: '6px 10px',
        backgroundColor: 'var(--bg-elevated, rgba(10, 14, 28, 0.92))',
        color: 'var(--text-primary)',
        fontSize: 'var(--font-size-sm)',
        borderRadius: 'var(--radius-sm)',
        border: '1px solid var(--border-default)',
        boxShadow: 'var(--shadow-elevated)',
        zIndex: '10000',
        whiteSpace: 'nowrap',
        pointerEvents: 'none',
        animation: 'kFadeIn 0.2s ease'
      });
      
      document.body.appendChild(tooltip);
      
      // Position tooltip
      const targetRect = target.getBoundingClientRect();
      const tooltipRect = tooltip.getBoundingClientRect();
      
      let top, left;
      
      switch (position) {
        case 'top':
          top = targetRect.top - tooltipRect.height - 8;
          left = targetRect.left + (targetRect.width - tooltipRect.width) / 2;
          break;
        case 'bottom':
          top = targetRect.bottom + 8;
          left = targetRect.left + (targetRect.width - tooltipRect.width) / 2;
          break;
        case 'left':
          top = targetRect.top + (targetRect.height - tooltipRect.height) / 2;
          left = targetRect.left - tooltipRect.width - 8;
          break;
        case 'right':
          top = targetRect.top + (targetRect.height - tooltipRect.height) / 2;
          left = targetRect.right + 8;
          break;
      }
      
      tooltip.style.top = `${top}px`;
      tooltip.style.left = `${left}px`;
    }, delay);
  };
  
  const hideTooltip = () => {
    if (timeout) {
      clearTimeout(timeout);
      timeout = null;
    }
    if (tooltip) {
      tooltip.style.animation = 'kFadeOut 0.2s ease';
      setTimeout(() => tooltip.remove(), 200);
      tooltip = null;
    }
  };
  
  target.addEventListener('mouseenter', showTooltip);
  target.addEventListener('mouseleave', hideTooltip);
  target.addEventListener('focus', showTooltip);
  target.addEventListener('blur', hideTooltip);
}

/**
 * Create a dropdown menu
 * @param {Object} options - Configuration options
 * @returns {HTMLElement} Dropdown element
 */
function createDropdown(options = {}) {
  const {
    trigger,
    items = [],
    position = 'bottom-left'
  } = options;
  
  const container = document.createElement('div');
  container.className = 'dropdown';
  container.style.position = 'relative';
  container.style.display = 'inline-block';
  
  const menu = document.createElement('div');
  menu.className = 'dropdown-menu hidden';
  
  Object.assign(menu.style, {
    position: 'absolute',
    minWidth: '160px',
    backgroundColor: 'var(--bg-secondary)',
    border: '1px solid var(--border-default)',
    borderRadius: 'var(--radius-md)',
    boxShadow: 'var(--shadow-elevated)',
    padding: 'var(--space-xs)',
    zIndex: '1000',
    animation: 'kFadeIn 0.2s ease'
  });
  
  // Position menu
  if (position.includes('bottom')) menu.style.top = '100%';
  if (position.includes('top')) menu.style.bottom = '100%';
  if (position.includes('left')) menu.style.left = '0';
  if (position.includes('right')) menu.style.right = '0';
  
  items.forEach((item) => {
    const menuItem = document.createElement('button');
    menuItem.className = 'dropdown-item';
    menuItem.textContent = item.label;
    
    Object.assign(menuItem.style, {
      display: 'block',
      width: '100%',
      padding: 'var(--space-sm)',
      textAlign: 'left',
      backgroundColor: 'transparent',
      border: 'none',
      color: 'var(--text-primary)',
      fontSize: 'var(--font-size-base)',
      cursor: 'pointer',
      borderRadius: 'var(--radius-sm)',
      transition: 'background-color var(--transition-fast)'
    });
    
    menuItem.addEventListener('mouseenter', () => {
      menuItem.style.backgroundColor = 'var(--accent-hover)';
    });
    
    menuItem.addEventListener('mouseleave', () => {
      menuItem.style.backgroundColor = 'transparent';
    });
    
    menuItem.addEventListener('click', () => {
      if (item.onClick) item.onClick();
      menu.classList.add('hidden');
    });
    
    menu.appendChild(menuItem);
  });
  
  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.classList.toggle('hidden');
  });
  
  // Close dropdown when clicking outside
  document.addEventListener('click', () => {
    menu.classList.add('hidden');
  });
  
  container.appendChild(trigger);
  container.appendChild(menu);
  
  return container;
}
