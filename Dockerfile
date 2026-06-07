# Dependencies stage - install all dependencies
FROM node:20-alpine AS deps
WORKDIR /app

# Copy package files and ONLY the Prisma schema. The postinstall `prisma
# generate` needs schema.prisma but not migrations/seeds — copying the whole
# prisma/ dir would bust the npm ci cache on every new migration.
COPY package.json package-lock.json ./
COPY prisma/schema.prisma ./prisma/schema.prisma

# npm cache mount keeps downloaded tarballs warm across builds, so a
# cache-busted reinstall reuses them instead of re-fetching from the registry.
RUN --mount=type=cache,target=/root/.npm npm ci --prefer-offline --no-audit --no-fund

# Development stage - for hot reloading during development
FROM node:20-alpine AS development
WORKDIR /app

# Create a non-root user for development
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Set environment variables for development
ENV NODE_ENV=development
ENV NEXT_TELEMETRY_DISABLED=1

# Create necessary directories with correct ownership upfront
RUN mkdir -p /app/.next && \
    touch /app/next-env.d.ts && \
    chown nextjs:nodejs /app/.next /app/next-env.d.ts

# Copy dependencies (already owned by nextjs:nodejs)
COPY --from=deps --chown=nextjs:nodejs /app/node_modules ./node_modules

# Copy source code (already owned by nextjs:nodejs)
COPY --chown=nextjs:nodejs . .

# Generate Prisma client
RUN npx prisma generate

# Expose the application and debug ports
EXPOSE 3000
EXPOSE 9229

# Switch to non-root user
USER nextjs

# Start the application in development mode
CMD ["npm", "run", "dev"]

# Builder stage - build the application
FROM node:20-alpine AS builder
WORKDIR /app

# Define build arguments for environment variables (will be passed from docker-build.sh)
ARG DATABASE_URL="postgresql://postgres:password@localhost:5432/shuttlementor"
ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY="pk_test_1234567890"
ARG CLERK_SECRET_KEY="sk_test_1234567890"

# Set environment variables for the build process
ENV DATABASE_URL=${DATABASE_URL}
ENV NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=${NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY}
ENV CLERK_SECRET_KEY=${CLERK_SECRET_KEY}
ENV NEXT_TELEMETRY_DISABLED=1

# Copy dependencies
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate Prisma client
RUN npx prisma generate

# Build the application (type checking is done separately via npm run typecheck)
RUN --mount=type=cache,target=/app/.next/cache npm run build

# Prune stage - remove dev dependencies
FROM node:20-alpine AS pruned
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
RUN npm prune --production

# Runner stage - production image
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Create a non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy necessary files
COPY --from=builder --chown=nextjs:nodejs /app/next.config.js ./
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next ./.next
COPY --from=pruned --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --chown=nextjs:nodejs docker-entrypoint.sh ./docker-entrypoint.sh

# Switch to non-root user
USER nextjs

# Expose the application port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD wget --spider -q http://localhost:3000/api/health || exit 1

# Start the application
CMD ["npm", "start"]
