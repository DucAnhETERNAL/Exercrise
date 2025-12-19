/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        inter: ['Inter', 'sans-serif'],
      },
      colors: {
        antoree: {
          green: '#00C853', // Antoree Green (Primary)
          darkGreen: '#009624',
          lightGreen: '#E8F5E9',
          blue: '#2979FF', // Secondary
          lightBlue: '#E3F2FD',
          text: '#212121',
          subText: '#757575',
        }
      }
    },
  },
  plugins: [],
}

