/**
 * Takosuya Theme Configuration
 * Visual identity: warm tones, rounded UI, friendly typography, energetic
 */

const TakosuyaTheme = {
  name: 'Takosuya',
  subtitle: 'A Kaneshiro Enterprise',
  
  // Color palette - warm and inviting
  colors: {
    // Base colors
    primary: '#dc2626',
    secondary: '#f59e0b',
    accent: '#fb923c',
    
    // Backgrounds - warm cream/peach tones
    background: '#fef3f2',
    backgroundSecondary: '#ffe4e1',
    backgroundTertiary: '#ffd4cc',
    
    // Text - dark for contrast on light backgrounds
    text: '#1a1a1a',
    textSecondary: '#4a4a4a',
    textMuted: '#737373',
    
    // Borders and dividers
    border: '#fca5a5',
    
    // Status colors
    success: '#22c55e',
    warning: '#f59e0b',
    error: '#ef4444',
    
    // Takosuya-specific
    warm: '#fb923c',
    energetic: '#dc2626',
    friendly: '#f59e0b'
  },
  
  // Typography - friendly and approachable
  fonts: {
    primary: "'Nunito', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    heading: "'Nunito', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    mono: "'SF Mono', 'Monaco', 'Courier New', monospace"
  },
  
  // Spacing (comfortable layout)
  spacing: {
    xs: '4px',
    sm: '8px',
    md: '16px',
    lg: '24px',
    xl: '32px',
    xxl: '48px'
  },
  
  // Border radius - rounded for friendliness
  borderRadius: {
    sm: '8px',
    md: '12px',
    lg: '16px',
    xl: '20px'
  },
  
  // Animation timing - energetic
  animation: {
    fast: '150ms',
    base: '200ms',
    slow: '250ms',
    ease: 'cubic-bezier(0.34, 1.56, 0.64, 1)' // Bouncy easing
  },
  
  // Identity characteristics
  identity: {
    style: 'warm',
    density: 'comfortable',
    animation: 'energetic',
    philosophy: 'fast, warm, efficient'
  },
  
  // Visual effects
  effects: {
    roundedCorners: true,
    warmGradients: true,
    energeticTransitions: true,
    friendlyAnimations: true
  }
};

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = TakosuyaTheme;
}
