<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1cbA5EF8SR_GPn5d4a9KFeOzKGgRZuvJQ

## Run Locally

**Prerequisites:**  Node.js (v18 or higher)

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create a `.env` file (copy from `.env.example`):
   ```bash
   cp .env.example .env
   ```

3. Set the following environment variables in `.env`:
   - `GEMINI_API_KEY`: Your Gemini API key ([Get here](https://aistudio.google.com/app/apikey))
   - `DRIVE_API_KEY`: Your Google Drive API key ([Get here](https://console.cloud.google.com/))

4. Run the app:
   ```bash
   npm run dev
   ```

## Deploy to Vercel

1. Push code to GitHub
2. Import project to Vercel
3. Add environment variables in Vercel dashboard:
   - `GEMINI_API_KEY`
   - `DRIVE_API_KEY`
4. Deploy!

**Important:** Make sure to add both API keys as environment variables in Vercel project settings.
