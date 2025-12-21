# Minimal production image - build the app outside Docker first with: npm run build
FROM node:22-alpine

WORKDIR /app

# Copy only the built output (pre-built outside Docker)
COPY application/.output ./.output

# Create data directory and set environment in one layer
RUN mkdir -p /app/.data && \
    addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app

# Set environment to production
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

# Expose the application port
EXPOSE 3000

# Run as non-root user
USER nodejs

# Run the application
CMD ["node", ".output/server/index.mjs"]
