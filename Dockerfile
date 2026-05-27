# ─── Stage 1: Build the frontend ────────────────────────────────────────────
FROM node:20-bookworm-slim AS frontend-builder

WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci --legacy-peer-deps

COPY frontend/ ./
ENV NODE_OPTIONS=--openssl-legacy-provider
ENV CI=false
RUN npm run build

# ─── Stage 2: Build the backend image ───────────────────────────────────────
FROM node:20-bookworm-slim

# Install build tools needed by better-sqlite3
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 make g++ ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY backend/package*.json ./backend/
WORKDIR /app/backend
RUN npm ci --legacy-peer-deps && npm cache clean --force

WORKDIR /app
COPY backend/ ./backend/

# Copy the built frontend from stage 1
COPY --from=frontend-builder /app/frontend/build ./frontend/build

# Have Express serve the built frontend
COPY docker-patch-server.js /tmp/docker-patch-server.js
RUN node /tmp/docker-patch-server.js && rm /tmp/docker-patch-server.js

# Create directories for persistent data
RUN mkdir -p /app/backend/data /app/uploads

EXPOSE 3001

ENV NODE_ENV=production
ENV PORT=3001

WORKDIR /app/backend
CMD ["node", "server.js"]
