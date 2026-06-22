ARG NODE_VERSION=24

# Stage 1: Build stage
FROM node:${NODE_VERSION}-alpine AS builder

WORKDIR /app

# Copy workspace manifest files first so npm ci is cached separately from source
COPY package.json package-lock.json ./
COPY application/package.json ./application/
COPY reporter/package.json ./reporter/
COPY integrations/nitro/package.json ./integrations/nitro/

# Install all dependencies; --ignore-scripts skips application's postinstall
# (nuxt prepare) which requires source files not yet present.
# nuxt build regenerates the same output during the build step below.
RUN --mount=type=cache,target=/root/.npm \
    npm ci --ignore-scripts

# Copy root tsconfig (extended by application/tsconfig.json)
COPY tsconfig.json ./

# Copy application source
COPY application/ ./application/

# Copy integrations (imported by server/plugins/piwi-test-logs.ts via relative path)
COPY integrations/ ./integrations/

# Build the application
ENV NITRO_PRESET=node-server
RUN npm run app:build --workspace=application

# Stage 2: Production stage with Alpine
FROM node:${NODE_VERSION}-alpine AS production

WORKDIR /app

# Set production environment
ARG PORT=3000
ENV NODE_ENV=production
ENV NITRO_HOST=0.0.0.0
ENV NITRO_PORT=${PORT}

# Copy workspace manifest files for production dependency install
COPY package.json package-lock.json ./
COPY application/package.json ./application/
COPY reporter/package.json ./reporter/

# Install production dependencies with cache mount
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --ignore-scripts

# Copy built artifacts from builder stage
COPY --from=builder /app/application/.output ./application/.output

# Security: Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app

USER nodejs

EXPOSE ${PORT}

CMD ["node", "application/.output/server/index.mjs"]
