# Docker Deployment Guide

This guide explains how to deploy the Playwright Dashboard using Docker.

## Quick Start with Docker

### Pull and Run

Pull the latest image from GitHub Container Registry and run it:

```bash
docker pull ghcr.io/phenx/playwright-dashboard:latest
docker run -p 3000:3000 -v $(pwd)/.data:/app/.data ghcr.io/phenx/playwright-dashboard:latest
```

The dashboard will be available at `http://localhost:3000`.

## Image Details

- **Base Image**: `node:24-alpine` (minimal Alpine Linux with Node.js 24)
- **Build Type**: Multistage build (builder + production stages)
- **Image Size**: ~200MB (compact without build dependencies)
- **Architecture**: Multi-platform (linux/amd64, linux/arm64)
- **Registry**: GitHub Container Registry (ghcr.io)

## Building the Image Locally

The image uses a multistage Docker build that handles all dependencies and building internally. Simply build the image:

```bash
cd application
docker build -t playwright-dashboard:local .
```

The Dockerfile uses a two-stage build:
1. **Builder stage**: Installs all dependencies and builds the application
2. **Production stage**: Installs only production dependencies and copies the build artifacts

### Run the Container

```bash
docker run -p 3000:3000 -v $(pwd)/.data:/app/.data playwright-dashboard:local
```

## Configuration

### Environment Variables

- `NODE_ENV=production` - Set automatically in the container
- `HOST=0.0.0.0` - Listens on all interfaces
- `PORT=3000` - Application port (default)
- `NUXT_AUTH_ENABLED` - Enable authentication (optional)
- `NUXT_AUTH_SECRET` - Secret for authentication (required if auth enabled)

### Volumes

Mount a volume to persist data:

```bash
docker run -p 3000:3000 \
  -v /path/to/data:/app/.data \
  ghcr.io/phenx/playwright-dashboard:latest
```

The `.data` directory contains:
- `playwright.db` - SQLite database
- `storage/` - Uploaded HTML reports and trace files

## Production Deployment

### Docker Compose

Create a `docker-compose.yml`:

```yaml
version: '3.8'

services:
  playwright-dashboard:
    image: ghcr.io/phenx/playwright-dashboard:latest
    ports:
      - "3000:3000"
    volumes:
      - ./data:/app/.data
    environment:
      - NODE_ENV=production
    restart: unless-stopped
```

Run with:

```bash
docker-compose up -d
```

### Kubernetes

Example deployment:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: playwright-dashboard
spec:
  replicas: 1
  selector:
    matchLabels:
      app: playwright-dashboard
  template:
    metadata:
      labels:
        app: playwright-dashboard
    spec:
      containers:
      - name: playwright-dashboard
        image: ghcr.io/phenx/playwright-dashboard:latest
        ports:
        - containerPort: 3000
        volumeMounts:
        - name: data
          mountPath: /app/.data
      volumes:
      - name: data
        persistentVolumeClaim:
          claimName: playwright-dashboard-data
---
apiVersion: v1
kind: Service
metadata:
  name: playwright-dashboard
spec:
  selector:
    app: playwright-dashboard
  ports:
  - port: 80
    targetPort: 3000
  type: LoadBalancer
```

## Security

The container runs as a non-root user (`nodejs:nodejs` with UID/GID 1001) for enhanced security.

## Available Tags

- `latest` - Latest stable release
- `v1.0.0` - Specific version (semver)
- `v1.0` - Major.minor version
- `v1` - Major version

## Image Optimization

This image is optimized for size using a multistage build:

1. **Multistage Build**: Application is built in a builder stage, keeping build dependencies separate
2. **Alpine Base**: Uses minimal Alpine Linux (~55MB base)
3. **Production Dependencies Only**: Final image contains only runtime dependencies
4. **Minimal Layers**: Commands combined to reduce layer count
5. **Cache Mounts**: Uses BuildKit cache mounts for faster npm installs
6. **Native Modules**: Platform-specific SQLite bindings built correctly for Alpine (musl)

## Technical Notes

### SQLite Implementation

The application uses `@libsql/client` which internally depends on the `libsql` package for native SQLite bindings. The multistage Docker build ensures that native modules are compiled correctly for Alpine Linux (musl) during the build process.

### Native Module Multi-Platform Support

The Docker build supports both `linux/amd64` and `linux/arm64` platforms. The multistage build ensures that native modules are compiled correctly for each target platform during the Docker build process.

## Troubleshooting

### Permission Issues

If you encounter permission issues with volumes, ensure the mounted directory is writable:

```bash
mkdir -p .data
chmod 777 .data  # or use appropriate permissions
docker run -p 3000:3000 -v $(pwd)/.data:/app/.data ghcr.io/phenx/playwright-dashboard:latest
```

### Database Locked

SQLite doesn't support concurrent writes well. For high-concurrency deployments, consider using a different database or running a single instance.

### Port Already in Use

If port 3000 is in use, map to a different port:

```bash
docker run -p 8080:3000 -v $(pwd)/.data:/app/.data ghcr.io/phenx/playwright-dashboard:latest
```

The dashboard will be available at `http://localhost:8080`.
