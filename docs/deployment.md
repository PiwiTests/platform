---
title: Deployment
lang: en-US
---

# Deployment

## Docker (recommended)

### Quick start

```bash
docker pull ghcr.io/phenx/piwi-dashboard:latest
docker run -p 3000:3000 -v $(pwd)/.data:/app/.data ghcr.io/phenx/piwi-dashboard:latest
```

The dashboard will be available at `http://localhost:3000`.

### Available tags

| Tag | Description |
|-----|-------------|
| `latest` | Latest stable release |
| `v1.0.0` | Specific version (semver) |
| `v1.0` | Major.minor version |
| `v1` | Major version |

### Image details

| Property | Value |
|----------|-------|
| Base image | `node:24-alpine` |
| Build type | Multistage (builder + production stages) |
| Image size | ~200 MB |
| Platforms | `linux/amd64`, `linux/arm64` |
| Registry | `ghcr.io/phenx/piwi-dashboard` |

### Volumes

Mount a volume to persist data:

```bash
docker run -p 3000:3000 \
  -v /path/to/data:/app/.data \
  ghcr.io/phenx/piwi-dashboard:latest
```

The `.data` directory contains:

- `playwright.db` — SQLite database
- `storage/` — HTML reports and trace files

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | `production` | Set automatically |
| `HOST` | `0.0.0.0` | Listen on all interfaces |
| `PORT` | `3000` | Application port |
| `NUXT_AUTH_ENABLED` | — | Enable authentication |
| `NUXT_AUTH_SECRET` | — | Secret for authentication (required if auth enabled) |
| `STORAGE_TYPE` | `local` | Storage backend (`local` or `s3`) |
| `DATABASE_URL` | — | PostgreSQL connection string (e.g. `postgresql://user:pass@host:5432/db`). When set, PostgreSQL is used instead of SQLite. |
| `DATABASE_PATH` | `.data/piwi.db` | SQLite database path (ignored when `DATABASE_URL` is set) |

## Building locally

```bash
cd application
docker build -t piwi-dashboard:local .
docker run -p 3000:3000 -v $(pwd)/.data:/app/.data piwi-dashboard:local
```

## Docker Compose

Create a `docker-compose.yml`:

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

Run with:

```bash
docker-compose up -d
```

### Docker Compose with PostgreSQL

For production deployments requiring a robust relational database:

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
      - DATABASE_URL=postgresql://playwright:playwright@postgres:5432/piwi_dashboard
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

## Kubernetes

Example deployment manifest:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: piwi-dashboard
spec:
  replicas: 1
  selector:
    matchLabels:
      app: piwi-dashboard
  template:
    metadata:
      labels:
        app: piwi-dashboard
    spec:
      containers:
      - name: piwi-dashboard
        image: ghcr.io/phenx/piwi-dashboard:latest
        ports:
        - containerPort: 3000
        volumeMounts:
        - name: data
          mountPath: /app/.data
      volumes:
      - name: data
        persistentVolumeClaim:
          claimName: piwi-dashboard-data
---
apiVersion: v1
kind: Service
metadata:
  name: piwi-dashboard
spec:
  selector:
    app: piwi-dashboard
  ports:
  - port: 80
    targetPort: 3000
  type: LoadBalancer
```

## Production build from source

```bash
cd application
npm install
npm run build
npm run preview  # preview the production build locally
```

## Security

The container runs as a non-root user (`nodejs:nodejs`, UID/GID 1001).

Security best practices:

- Always use HTTPS in production
- Mount `.data/` on a persistent volume
- Set a strong `NUXT_AUTH_SECRET` and enable authentication

## Troubleshooting

### Permission issues with volumes

```bash
mkdir -p .data
chmod 777 .data
docker run -p 3000:3000 -v $(pwd)/.data:/app/.data ghcr.io/phenx/piwi-dashboard:latest
```

### Database locked

SQLite doesn't support concurrent writes well. For high-concurrency deployments, run a single instance or switch to PostgreSQL by setting `DATABASE_URL`.

### Port already in use

Map to a different host port:

```bash
docker run -p 8080:3000 -v $(pwd)/.data:/app/.data ghcr.io/phenx/piwi-dashboard:latest
```

The dashboard will be available at `http://localhost:8080`.
