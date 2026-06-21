# Docker Deployment Guide

This guide explains how to deploy the Piwi Dashboard using Docker.

> **Note:** For the complete deployment reference including Kubernetes and production build from source, see the [full deployment documentation](https://phenx.github.io/piwi-dashboard/deployment).

## Quick Start with Docker

### Pull and Run

Pull the latest image from GitHub Container Registry and run it:

```bash
docker pull ghcr.io/phenx/piwi-dashboard:latest
docker run -p 3000:3000 -v $(pwd)/.data:/app/.data ghcr.io/phenx/piwi-dashboard:latest
```

The dashboard will be available at `http://localhost:3000`.

## Image Details

- **Base Image**: `node:24-alpine` (minimal Alpine Linux with Node.js 24)
- **Build Type**: Multistage build (builder + production stages)
- **Image Size**: ~200MB (compact without build dependencies)
- **Architecture**: Multi-platform (linux/amd64, linux/arm64)
- **Registry**: GitHub Container Registry (ghcr.io)

## Building the Image Locally

```bash
cd application
docker build -t piwi-dashboard:local .
docker run -p 3000:3000 -v $(pwd)/.data:/app/.data piwi-dashboard:local
```

The Dockerfile uses a two-stage build:
1. **Builder stage**: Installs all dependencies and builds the application
2. **Production stage**: Installs only production dependencies and copies the build artifacts

## Configuration

### Environment Variables

| Variable               | Default         | Description                                                                  |
|------------------------|-----------------|------------------------------------------------------------------------------|
| `NODE_ENV`             | `production`    | Set automatically in the container                                           |
| `HOST`                 | `0.0.0.0`       | Listens on all interfaces                                                    |
| `PORT`                 | `3000`          | Application port                                                             |
| `PIWI_SECRET_KEY`      | —               | Master key for encrypting secrets in the DB (AI keys, SCM tokens). Recommended in all deployments. |
| `PIWI_AUTH_ENABLED`    | —               | Enable authentication (`true`/`false`)                                       |
| `PIWI_AUTH_SECRET`     | —               | Secret for encrypting session cookies (required if auth enabled)             |
| `PIWI_DATABASE_URL`         | —               | PostgreSQL connection string; when set, PostgreSQL is used instead of SQLite |
| `PIWI_DATABASE_PATH`        | `.data/piwi.db` | SQLite database path (ignored when `PIWI_DATABASE_URL` is set)                    |
| `PIWI_STORAGE_TYPE`         | `local`         | Storage backend (`local` or `s3`)                                            |
| `PIWI_S3_BUCKET`            | —               | S3 bucket name (when `PIWI_STORAGE_TYPE=s3`)                                      |
| `PIWI_S3_REGION`            | —               | S3 region                                                                    |
| `PIWI_S3_ACCESS_KEY_ID`     | —               | S3 access key                                                                |
| `PIWI_S3_SECRET_ACCESS_KEY` | —               | S3 secret key                                                                |
| `PIWI_S3_ENDPOINT`          | —               | Custom S3 endpoint (for MinIO, R2, Spaces, etc.)                             |

### Volumes

Mount a volume to persist data:

```bash
docker run -p 3000:3000 \
  -v /path/to/data:/app/.data \
  ghcr.io/phenx/piwi-dashboard:latest
```

The `.data` directory contains:
- `piwi.db` — SQLite database (unless using PostgreSQL)
- `storage/` — Uploaded HTML reports and trace files

## Docker Compose

### SQLite (default)

```yaml
services:
  piwi-dashboard:
    image: ghcr.io/phenx/piwi-dashboard:latest
    ports:
      - "3000:3000"
    volumes:
      - ./data:/app/.data
    environment:
      - NODE_ENV=production
    restart: unless-stopped
```

### With PostgreSQL

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: playwright
      POSTGRES_PASSWORD: playwright
      POSTGRES_DB: piwi_dashboard
    volumes:
      - pg-data:/var/lib/postgresql/data
    restart: unless-stopped

  piwi-dashboard:
    image: ghcr.io/phenx/piwi-dashboard:latest
    ports:
      - "3000:3000"
    volumes:
      - ./storage:/app/.data/storage
    environment:
      - NODE_ENV=production
      - PIWI_DATABASE_URL=postgresql://playwright:playwright@postgres:5432/piwi_dashboard
    depends_on:
      - postgres
    restart: unless-stopped

volumes:
  pg-data:
```

Run with:

```bash
docker-compose up -d
```

## Security

The container runs as a non-root user (`nodejs:nodejs` with UID/GID 1001) for enhanced security.

Best practices:
- Always use HTTPS in production (use a reverse proxy like nginx or Traefik)
- Set `PIWI_SECRET_KEY` with `openssl rand -hex 32` to encrypt secrets at rest (recommended even without auth)
- Set `PIWI_AUTH_SECRET` with `openssl rand -hex 32` when authentication is enabled
- Enable authentication for multi-user or internet-facing deployments

## Available Tags

- `latest` — Latest stable release
- `v1.0.0` — Specific version (semver)
- `v1.0` — Major.minor version
- `v1` — Major version

## Troubleshooting

### Permission Issues

If you encounter permission issues with volumes, ensure the mounted directory is writable by UID 1001:

```bash
mkdir -p .data
chmod 777 .data  # or chown 1001:1001 .data
docker run -p 3000:3000 -v $(pwd)/.data:/app/.data ghcr.io/phenx/piwi-dashboard:latest
```

### Database Locked

SQLite doesn't support concurrent writes well. For high-concurrency deployments, switch to PostgreSQL by setting `PIWI_DATABASE_URL`.

### Port Already in Use

Map to a different host port:

```bash
docker run -p 8080:3000 -v $(pwd)/.data:/app/.data ghcr.io/phenx/piwi-dashboard:latest
```

The dashboard will be available at `http://localhost:8080`.
