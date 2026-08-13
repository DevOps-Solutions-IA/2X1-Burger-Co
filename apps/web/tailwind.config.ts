import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: '#F4F1EA',
        canvas: '#F4F1EA',
        panel: '#FFFEFB',
        ink: '#171713',
        muted: '#706D63',
        line: '#DED9CC',
        brand: {
          50: '#FFF3D6',
          100: '#FFE8B0',
          200: '#FFBB4D',
          300: '#FFAA33',
          400: '#FDBA30',
          500: '#FF9F1C',
          600: '#F58A07',
          700: '#D97706',
          800: '#B86B12',
          900: '#8A4F0C',
        },
        accent: '#0B0B0B',
        danger: '#b42318',
        signal: {
          success: '#247247',
          warning: '#A45B08',
          danger: '#B42318',
          info: '#23638A',
          neutral: '#68655D',
        },
        sofia: {
          50: '#F5F3FF',
          100: '#EDE9FE',
          200: '#DDD6FE',
          300: '#C4B5FD',
          400: '#A78BFA',
          500: '#8B5CF6',
          600: '#6D3DEB',
          700: '#5323A8',
          800: '#37156F',
          900: '#24104A',
          950: '#16072F',
        },
      },
      boxShadow: {
        soft: '0 22px 40px -28px rgba(26,26,26,0.18)',
      },
      borderRadius: {
        xl2: '1.25rem',
      },
      fontFamily: {
        sans: ['var(--font-body)', 'ui-sans-serif', 'system-ui'],
        heading: ['var(--font-heading)', 'ui-sans-serif', 'system-ui'],
      },
    },
  },
  plugins: [],
};

export default config;
