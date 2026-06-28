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
RUN npm run app:build --workspace=application && \
    rm -rf application/.output/server/node_modules/@img/sharp-libvips-linux-x64 && \
    rm -rf application/.output/server/node_modules/@img/sharp-linux-x64 && \
    rm -rf application/.output/server/node_modules/@libsql/linux-x64-gnu && \
    rm -rf application/.output/server/node_modules/sql.js && \
    rm -rf application/.output/public/demo

# Stage 2: Production stage
FROM node:${NODE_VERSION}-alpine AS production

WORKDIR /app

ARG PORT=3000
ENV NODE_ENV=production
ENV NITRO_HOST=0.0.0.0
ENV NITRO_PORT=${PORT}

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown nodejs:nodejs /app

# Copy workspace files for native module install (sharp, libsql, sql.js)
# Pure-JS deps are inlined by Nitro noExternals — only native binaries needed here
COPY package.json package-lock.json ./

# Trim workspaces to just application
RUN printf "import{readFileSync,writeFileSync}from'node:fs';const p=JSON.parse(readFileSync('package.json','utf8'));p.workspaces=['application'];writeFileSync('package.json',JSON.stringify(p));" > /tmp/fix.mjs && node /tmp/fix.mjs && rm /tmp/fix.mjs

# Install only the native packages needed at runtime (sharp + libsql + sql.js)
# All pure-JS deps are bundled into .output by Nitro's noExternals
# Run as nodejs to avoid a duplicate chown layer
USER nodejs

ENV npm_config_cache=/home/nodejs/.npm

RUN --mount=type=cache,target=/home/nodejs/.npm,uid=1001,gid=1001 \
    npm install --omit=dev --ignore-scripts \
    sharp @libsql/client @libsql/linux-x64-musl && \
    npm cache clean --force && \
    rm -rf node_modules/@img/sharp-libvips-linux-x64 && \
    rm -rf node_modules/@img/sharp-linux-x64 && \
    rm -rf node_modules/@libsql/linux-x64-gnu && \
    rm -rf node_modules/sql.js 2>/dev/null; \
    find node_modules -type d \( -name "test" -o -name "tests" -o -name ".devcontainer" \) -exec rm -rf {} + 2>/dev/null || true

# Copy built application — pure-JS deps inlined by Nitro noExternals
COPY --chown=nodejs:nodejs --from=builder /app/application/.output ./application/.output

EXPOSE ${PORT}

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "application/.output/server/index.mjs"]
