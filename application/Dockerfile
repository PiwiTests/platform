ARG NODE_VERSION=24

# Stage 1: Build stage
FROM node:${NODE_VERSION}-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install ALL dependencies with cache mount
RUN --mount=type=cache,target=/root/.npm \
    npm ci

# Copy source code
COPY .  .

# Build the application
ENV NITRO_PRESET=node-server
RUN npm run build

# Stage 2: Production stage with Alpine
FROM node:${NODE_VERSION}-alpine AS production

WORKDIR /app

# Set production environment
ARG PORT=3000
ENV NODE_ENV=production
ENV NITRO_HOST=0.0.0.0
ENV NITRO_PORT=${PORT}

# Install production dependencies with cache mount
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --only=production

# Copy built artifacts from builder stage
COPY --from=builder /app/.output ./.output

# Security:  Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app

USER nodejs

EXPOSE ${PORT}

CMD ["node", ".output/server/index.mjs"]
