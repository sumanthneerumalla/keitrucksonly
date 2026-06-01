# ShuttleMentor

[![CI](https://github.com/sumanthneerumalla/shuttleMentor/actions/workflows/ci.yml/badge.svg)](https://github.com/sumanthneerumalla/shuttleMentor/actions/workflows/ci.yml)

## Libraries Used

The stack used in this project is 
- [Next.js](https://nextjs.org)
- [NextAuth.js](https://next-auth.js.org)
- [Prisma](https://prisma.io)
- [Drizzle](https://orm.drizzle.team)
- [Tailwind CSS](https://tailwindcss.com)
- [tRPC](https://trpc.io)

## ShuttleMentor Local Setup Guide

This guide will help you set up and run the ShuttleMentor badminton coaching platform on your computer. No technical background required.

## What You'll Need

- A computer with internet connection
- About 30 minutes of time
- Administrator access to install software

## Step 1: Install Required Software

### 1.1 Install Git

**For Windows:** https://git-scm.com/download/win (download and run the installer, use default settings)

**For Mac:** Open Terminal and run `git --version`. If Git isn't installed, follow the prompts to install it.

**For Linux:**
```bash
sudo apt update
sudo apt install git
```

### 1.2 Install Docker

Docker will run the application and database for you.

**For Windows:** https://docs.docker.com/desktop/install/windows-install/ (restart your computer when prompted)

**For Mac:** https://docs.docker.com/desktop/install/mac-install/ (choose Intel or Apple Silicon based on your Mac)

**For Linux:** https://docs.docker.com/desktop/install/linux-install/

### 1.3 Install Node.js (Optional but Recommended)

https://nodejs.org/ (download the LTS version)

## Step 2: Get the Project Files

1. Choose a location (e.g., `Documents/ShuttleMentor`)
2. Open Terminal/Command Prompt:
   - **Windows:** press Win+R, type `cmd`, press Enter
   - **Mac:** press Cmd+Space, type "Terminal", press Enter
   - **Linux:** press Ctrl+Alt+T
3. Navigate to your chosen folder:
   ```bash
   cd Documents/ShuttleMentor
   ```
4. Download the project:
   ```bash
   git clone [YOUR_REPOSITORY_URL]
   cd shuttlementor
   ```
   *Note: Replace [YOUR_REPOSITORY_URL] with the actual repository URL*

## Step 3: Set Up Configuration

### 3.1 Create Environment File

1. Copy `.env.example` to a new file named `.env`
2. Open the `.env` file in a text editor
3. Set the DB connection details in the `.env` file (see `.env.example` for the format). The `start_database.sh` script can generate a random password and update the URL for you. If you are using orbstack MAKE SURE TO CHECK WHAT URL IT PROVIDES FOR THE DB CONTAINER! It will be a url with "orb.local" rather than "localhost"

The database settings in `.env` should work as-is for local development:
```
DATABASE_URL="postgresql://postgres:password@localhost:5432/shuttlementor"
```

### 3.2 Get Clerk Authentication Keys

1. Go to https://clerk.com/
2. Create a new application
3. In your `.env` file, set `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY`

## Step 4: Start the Application

### Method 1: Using Docker (Recommended)

1. Make sure Docker is running
2. Start the application:
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
   ```
3. Wait until you see: `Ready - started server on 0.0.0.0:3000`

   This will take 5-10 minutes the first time, and you'll see lots of text scrolling by.

For local development using Docker (including app + PostgreSQL containers, migrations, and Prisma Studio), see:

- [Docker Usage Guide](./docs/docker-usage.md)

### Method 2: Using Node.js (Alternative)

1. Install dependencies:
   ```bash
   npm install
   ```
2. Start the database:
   ```bash
   ./start-database.sh
   ```
3. Set up the database:
   ```bash
   npm run db:generate
   npm run db:migrate
   ```
4. Start the application:
   ```bash
   npm run dev
   ```

## Step 5: Access the Application

1. Open http://localhost:3000
2. Sign in and use your Gmail account
3. Set up admin access:
   - Run `npx prisma studio` (Node.js) or `docker compose exec app npx prisma studio` (Docker)
   - Open http://localhost:5555
   - Find your user record and change the `role` (user type) field to `ADMIN`
   - Refresh the main application to see admin features

## Step 6: Stopping the Application

### If using Docker:

Press `Ctrl+C` in the terminal, then run:
```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml down
```

### If using Node.js:

Press `Ctrl+C` in both terminal windows (app and database)

## Adding a New Club

Two places need to be updated when adding a new club:

1. **Database** — Insert a row into the `Club` table with the new `clubShortName` and `clubName`. You can do this via Prisma Studio (`npx prisma studio`) or a SQL insert:
   ```sql
   INSERT INTO "Club" ("clubShortName", "clubName") VALUES ('myclub', 'My Club Name');
   ```

2. **Landing page short-URL routing** — Add the new `clubShortName` to the `CLUB_LANDING_SHORTNAMES` array in `src/lib/clubLanding.ts` so the middleware recognises `/<clubShortName>` as a valid club landing page URL:
   ```ts
   export const CLUB_LANDING_SHORTNAMES = ["cba", "squashdublin", "myclub"] as const;
   ```

After both steps, visiting `/<clubShortName>` (e.g. `/myclub`) will show the club-specific landing page and sign-up flow.

## Troubleshooting

**"Port already in use" error:** Something else is using port 3000. Try stopping other applications or restart your computer.

**Docker won't start:** Make sure Docker Desktop is running. Try restarting Docker Desktop.

**Can't access the application:** Make sure you're using http://localhost:3000 (not https). Check that the application started successfully.

**Database connection errors:** Make sure the database container is running. Check that your `.env` file has the correct database URL.

### Getting Help

If you run into issues:

1. Check the terminal output for error messages
2. Make sure all prerequisites are installed correctly
3. Try restarting Docker Desktop and running the commands again
4. Contact the development team with specific error messages

