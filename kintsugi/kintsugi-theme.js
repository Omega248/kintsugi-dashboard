/**
 * Kintsugi Theme Configuration
 * Visual identity: charcoal/slate, gold vein accents, elegant spacing
 */

const KintsugiTheme = {
  name: 'Kintsugi',
  subtitle: 'A Kaneshiro Enterprise',
  
  // Color palette
  colors: {
    // Base colors
    primary: '#2d3748',
    secondary: '#D4AF37',
    accent: '#B8860B',
    
    // Backgrounds
    background: '#1a202c',
    backgroundSecondary: '#2d3748',
    backgroundTertiary: '#374151',
    
    // Text
    text: '#e5e7eb',
    textSecondary: '#cbd5e0',
    textMuted: '#9ca3af',
    
    // Borders and dividers
    border: '#4a5568',
    
    // Status colors
    success: '#22c55e',
    warning: '#f59e0b',
    error: '#ef4444',
    
    // Kintsugi-specific
    goldVein: '#D4AF37',
    goldVeinGlow: 'rgba(212, 175, 55, 0.3)',
    slate: '#2d3748',
    charcoal: '#1a202c'
  },
  
  // Typography
  fonts: {
    primary: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    heading: "'Crimson Pro', Georgia, serif",
    mono: "'SF Mono', 'Monaco', 'Courier New', monospace"
  },
  
  // Spacing (spacious layout)
  spacing: {
    xs: '6px',
    sm: '12px',
    md: '20px',
    lg: '32px',
    xl: '48px',
    xxl: '64px'
  },
  
  // Border radius
  borderRadius: {
    sm: '6px',
    md: '10px',
    lg: '14px',
    xl: '18px'
  },
  
  // Animation timing
  animation: {
    fast: '200ms',
    base: '300ms',
    slow: '400ms',
    ease: 'cubic-bezier(0.4, 0.0, 0.2, 1)'
  },
  
  // Identity characteristics
  identity: {
    style: 'elegant',
    density: 'spacious',
    animation: 'slow',
    philosophy: 'calm, spacious, intentional'
  },
  
  // Visual effects
  effects: {
    goldVeinSeparator: true,
    texturedBackground: true,
    slowTransitions: true,
    refinedAnimations: true
  }
};

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = KintsugiTheme;
}
