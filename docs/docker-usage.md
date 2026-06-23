# Docker Usage Guide for ShuttleMentor

This document provides instructions for working with the ShuttleMentor application using Docker.

## Prerequisites

- Docker and Docker Compose installed on your system
- Git repository cloned locally

## Development Workflow

### Starting the Development Environment

The development environment is configured for hot reloading, so your changes will be reflected immediately:

```bash
# Start the development environment
npm run docker:dev

# Or using Docker Compose directly
docker compose -f docker-compose.yml -f docker-compose.local.yml up
```

### Debugging

For debugging server-side code:

1. Start the application in debug mode:
   ```bash
   npm run docker:dev
   ```

2. In VS Code:
   - Open the Debug panel
   - Select "Docker: Debug Server-Side" from the dropdown
   - Press F5 to attach the debugger

3. You can now set breakpoints in your server-side code

### Database Migrations

To run database migrations in the Docker environment:

```bash
npm run docker:db:migrate
```

## Production Deployment

### Building for Production

```bash
# Build the production image
docker compose -f docker-compose.yml -f docker-compose.deployed.yml -f docker-compose.hosted-prod.yml build
```

### Starting Production Environment

```bash
# Start the production environment
docker compose -f docker-compose.yml -f docker-compose.deployed.yml -f docker-compose.hosted-prod.yml up -d
```

### Environment Variables

Create a `.env` file with the following variables:

```
DATABASE_URL=postgresql://postgres:password@db:5432/shuttlementor
DB_PASSWORD=your_secure_password
DB_NAME=shuttlementor
DB_PORT=5432
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=your_clerk_publishable_key
CLERK_SECRET_KEY=your_clerk_secret_key
```

## Network Architecture

The Docker setup uses two separate networks:

1. `frontend` - Connects the application to the outside world
2. `backend` - Internal network for database communication (not accessible externally)

This provides proper network isolation for security.

## Health Checks

The application includes health checks at:

- `/api/health` - Application health endpoint
- Database health is monitored via PostgreSQL's `pg_isready`

## Resource Limits

Production containers have resource limits configured:

- App container: 1 CPU, 1GB memory
- Database: Uses default PostgreSQL settings

## Troubleshooting

### Container Logs

```bash
# View logs for the app container
docker compose logs app

# Follow logs in real-time
docker compose logs -f app
```

### Restarting Services

```bash
# Restart just the app container
docker compose restart app

# Restart all services
docker compose restart
```

### Database Access

```bash
# Access the PostgreSQL CLI
docker compose exec db psql -U postgres -d shuttlementor
```
