/**
 * Navigation System
 * Manages hierarchical navigation between Kaneshiro, Kintsugi, and Takosuya
 */

class Navigation {
  constructor() {
    this.structure = {
      kaneshiro: {
        name: 'Kaneshiro Enterprises',
        path: '/kaneshiro/kaneshiro-index.html',
        level: 'executive',
        children: ['kintsugi', 'takosuya']
      },
      kintsugi: {
        name: 'Kintsugi',
        path: '/kintsugi/kintsugi-index.html',
        level: 'subsidiary',
        parent: 'kaneshiro',
        subtitle: 'A Kaneshiro Enterprise'
      },
      takosuya: {
        name: 'Takosuya',
        path: '/takosuya/takosuya-index.html',
        level: 'subsidiary',
        parent: 'kaneshiro',
        subtitle: 'A Kaneshiro Enterprise'
      }
    };
    
    this.currentContext = this.detectContext();
  }

  /**
   * Detect current context from URL
   */
  detectContext() {
    const path = window.location.pathname;
    
    if (path.includes('/kaneshiro/')) return 'kaneshiro';
    if (path.includes('/kintsugi/')) return 'kintsugi';
    if (path.includes('/takosuya/')) return 'takosuya';
    
    // Default based on filename patterns in root
    if (path.includes('index.html') || path === '/') {
      return 'kintsugi'; // Legacy default
    }
    
    return 'kaneshiro';
  }

  /**
   * Get current context
   */
  getContext() {
    return this.currentContext;
  }

  /**
   * Set current context
   */
  setContext(context) {
    if (this.structure[context]) {
      this.currentContext = context;
      
      // Store preference
      try {
        localStorage.setItem('kaneshiro_context', context);
      } catch (e) {
        console.warn('Could not save context:', e);
      }

      // Dispatch event
      window.dispatchEvent(new CustomEvent('contextchange', {
        detail: { context }
      }));
    }
  }

  /**
   * Navigate to a context
   */
  navigateTo(context) {
    const target = this.structure[context];
    if (!target) {
      console.error(`Context "${context}" not found`);
      return;
    }

    // Get base path (remove filename from current path)
    const currentPath = window.location.pathname;
    const basePath = currentPath.substring(0, currentPath.lastIndexOf('/'));
    
    // Navigate relative to repository root
    const newPath = target.path;
    window.location.href = newPath;
  }

  /**
   * Get navigation structure
   */
  getStructure() {
    return this.structure;
  }

  /**
   * Get parent context
   */
  getParent(context = this.currentContext) {
    const ctx = this.structure[context];
    return ctx && ctx.parent ? this.structure[ctx.parent] : null;
  }

  /**
   * Get children contexts
   */
  getChildren(context = this.currentContext) {
    const ctx = this.structure[context];
    if (!ctx || !ctx.children) return [];
    
    return ctx.children.map(child => this.structure[child]);
  }

  /**
   * Build navigation header HTML
   */
  buildHeader() {
    const current = this.structure[this.currentContext];
    if (!current) return '';

    const parent = this.getParent();
    const siblings = parent ? this.getChildren(current.parent) : [];

    let html = '<nav class="kaneshiro-nav">';
    
    // Always show Kaneshiro Enterprises link
    html += `
      <div class="nav-brand">
        <a href="/kaneshiro/kaneshiro-index.html" class="nav-brand-link">
          <span class="nav-brand-name">Kaneshiro Enterprises</span>
        </a>
      </div>
    `;

    // Show subsidiary navigation if we have siblings
    if (siblings.length > 0) {
      html += '<div class="nav-subsidiaries">';
      siblings.forEach(sub => {
        const active = sub.name.toLowerCase() === this.currentContext ? 'active' : '';
        html += `
          <a href="${sub.path}" class="nav-sub-link ${active}" data-context="${sub.name.toLowerCase()}">
            ${sub.name}
          </a>
        `;
      });
      html += '</div>';
    }

    // Show subtitle if exists
    if (current.subtitle) {
      html += `<div class="nav-subtitle">${current.subtitle}</div>`;
    }

    html += '</nav>';
    
    return html;
  }

  /**
   * Inject navigation into page
   */
  inject(containerId = 'nav-container') {
    const container = document.getElementById(containerId);
    if (container) {
      container.innerHTML = this.buildHeader();
      this.attachEventListeners();
    } else {
      // Try to inject before body content
      if (document.body) {
        const nav = document.createElement('div');
        nav.id = 'nav-container';
        nav.innerHTML = this.buildHeader();
        document.body.insertBefore(nav, document.body.firstChild);
        this.attachEventListeners();
      }
    }
  }

  /**
   * Attach event listeners for navigation
   */
  attachEventListeners() {
    const links = document.querySelectorAll('.nav-sub-link');
    links.forEach(link => {
      link.addEventListener('click', (e) => {
        const context = link.dataset.context;
        if (context) {
          this.setContext(context);
        }
      });
    });
  }

  /**
   * Get breadcrumb trail
   */
  getBreadcrumbs() {
    const trail = [];
    let context = this.currentContext;

    while (context) {
      const ctx = this.structure[context];
      if (ctx) {
        trail.unshift({
          name: ctx.name,
          path: ctx.path,
          context: context
        });
        context = ctx.parent;
      } else {
        break;
      }
    }

    return trail;
  }

  /**
   * Build breadcrumb HTML
   */
  buildBreadcrumbs() {
    const trail = this.getBreadcrumbs();
    
    let html = '<nav class="breadcrumbs">';
    trail.forEach((item, index) => {
      const isLast = index === trail.length - 1;
      const separator = isLast ? '' : '<span class="breadcrumb-sep">›</span>';
      
      if (isLast) {
        html += `<span class="breadcrumb-current">${item.name}</span>`;
      } else {
        html += `<a href="${item.path}" class="breadcrumb-link">${item.name}</a>${separator}`;
      }
    });
    html += '</nav>';

    return html;
  }
}

// Create global instance
const navigation = new Navigation();

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Navigation, navigation };
}
