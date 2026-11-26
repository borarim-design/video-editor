/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        studio: {
          950: '#080a10',
          900: '#0b0e14',
          850: '#0f141d',
          800: '#121826',
          750: '#161d2c',
          700: '#1b2434',
          600: '#263145',
          500: '#37455e',
          400: '#5a6c8a',
          300: '#8b9bb8',
          200: '#bcc8dd',
          100: '#e6ebf5',
        },
        neon: {
          DEFAULT: '#7c5cff',
          soft: '#a78bfa',
          cyan: '#38bdf8',
          lime: '#bef264',
          amber: '#fbbf24',
          rose: '#fb7185',
        },
      },
      fontFamily: {
        sans: ['Pretendard', 'system-ui', '-apple-system', 'Malgun Gothic', 'sans-serif'],
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(124,92,255,0.35), 0 12px 40px -12px rgba(124,92,255,0.55)',
        panel: '0 1px 0 0 rgba(255,255,255,0.04) inset, 0 20px 50px -30px rgba(0,0,0,0.9)',
      },
      keyframes: {
        pulseSoft: {
          '0%, 100%': { opacity: '0.55' },
          '50%': { opacity: '1' },
        },
      },
      animation: { pulseSoft: 'pulseSoft 1.6s ease-in-out infinite' },
    },
  },
  plugins: [],
};
