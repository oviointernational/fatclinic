/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Off-white light theme
        light: {
          bg: '#F8F9FA',
          card: '#FFFFFF',
          subtle: '#F1F3F5',
          border: '#E9ECEF',
          text: '#1E293B',
          muted: '#64748B'
        },
        // Off-black-blueish dark theme
        dark: {
          bg: '#0A0F1D',
          card: '#111A2E',
          surface: '#16223B',
          border: '#1E2E4E',
          text: '#F8FAFC',
          muted: '#94A3B8'
        },
        clinic: {
          50: '#F0FDF4',
          100: '#DCFCE7',
          500: '#10B981',
          600: '#059669',
          700: '#047857',
          blue: '#0284C7',
          teal: '#0D9488',
          amber: '#F59E0B',
          rose: '#E11D48'
        }
      },
      animation: {
        'pulse-glow': 'pulseGlow 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
      keyframes: {
        pulseGlow: {
          '0%, 100%': {
            boxShadow: '0 0 0 0 rgba(16, 185, 129, 0.6), 0 0 15px rgba(16, 185, 129, 0.4)',
            transform: 'scale(1)'
          },
          '50%': {
            boxShadow: '0 0 0 8px rgba(16, 185, 129, 0), 0 0 25px rgba(16, 185, 129, 0.7)',
            transform: 'scale(1.04)'
          },
        }
      }
    },
  },
  plugins: [],
}
