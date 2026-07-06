# Lumina Notes

A secure, real-time notes application with password protection and theme customization.

## Features

- 📝 Create and manage notes with rich text support
- 🔒 Password protection for sensitive notes
- 🎨 Multiple theme options (Cosmic, Aurora, Midnight, Sunset)
- 💾 Auto-save functionality
- 🔗 Share notes via links
- 📱 Responsive design
- ⚡ Real-time sync across tabs

## Deployment to Netlify

### Prerequisites

1. A PostgreSQL database (you can use [ElephantSQL](https://www.elephantsql.com/) free tier or [Supabase](https://supabase.com/))
2. A [Netlify](https://www.netlify.com/) account
3. Git installed on your machine

### Steps to Deploy

1. **Set up your database:**
   - Create a PostgreSQL database (recommended: ElephantSQL or Supabase)
   - Copy your database connection string

2. **Push to GitHub:**
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin YOUR_GITHUB_REPO_URL
   git push -u origin main
   ```

3. **Deploy to Netlify:**
   - Log in to [Netlify](https://app.netlify.com/)
   - Click "Add new site" > "Import an existing project"
   - Connect your GitHub repository
   - Configure build settings:
     - Build command: (leave empty)
     - Publish directory: `.`
   - Click "Deploy site"

4. **Add Environment Variables:**
   - Go to Site settings > Environment variables
   - Add the following variable:
     - Key: `DATABASE_URL`
     - Value: Your PostgreSQL connection string

5. **Redeploy:**
   - Go to Deploys tab
   - Click "Trigger deploy" > "Deploy site"

Your app should now be live! 🎉

## Local Development

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```

3. Create a `.env` file with your database URL:
   ```
   DATABASE_URL=your_postgresql_connection_string
   ```

4. Run the development server:
   ```bash
   npm start
   ```

5. Open `http://localhost:3000` in your browser

## Tech Stack

- Frontend: Vanilla JavaScript, HTML5, CSS3
- Backend: Netlify Functions (Serverless)
- Database: PostgreSQL
- Hosting: Netlify

## License

MIT
