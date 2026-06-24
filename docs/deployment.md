---
title: Deployment
lang: en-US
---

# Deployment

## Docker (recommended)

### Quick start

::: code-group

```bash [Linux / macOS]
docker pull ghcr.io/piwitests/dashboard:latest
docker run -p 3000:3000 -v $(pwd)/.data:/app/.data ghcr.io/piwitests/dashboard:latest
```

```powershell [Windows (PowerShell)]
docker pull ghcr.io/piwitests/dashboard:latest
docker run -p 3000:3000 -v ${PWD}/.data:/app/.data ghcr.io/piwitests/dashboard:latest
```

:::

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
| Registry | `ghcr.io/piwitests/dashboard` |

### Volumes

Mount a volume to persist data:

```bash
docker run -p 3000:3000 -v /path/to/data:/app/.data ghcr.io/piwitests/dashboard:latest
```

> On Windows, use a host path like `C:\piwi\data` (PowerShell) in place of `/path/to/data`.

The `.data` directory contains:

- `piwi.db` — SQLite database
- `storage/` — HTML reports and trace files

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | `production` | Set automatically |
| `HOST` | `0.0.0.0` | Listen on all interfaces |
| `PORT` | `3000` | Application port |
| `PIWI_SECRET_KEY` | — | Master key for encrypting secrets in the database (AI API keys, SCM tokens). Recommended in all deployments. Generate with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` (or `openssl rand -hex 32`). |
| `PIWI_AUTH_ENABLED` | — | Enable authentication |
| `PIWI_AUTH_SECRET` | — | Secret for encrypting session cookies (required if auth enabled). Generate with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` (or `openssl rand -hex 32`). |
| `PIWI_STORAGE_TYPE` | `local` | Storage backend (`local` or `s3`) |
| `PIWI_DATABASE_URL` | — | PostgreSQL connection string (e.g. `postgresql://user:pass@host:5432/db`). When set, PostgreSQL is used instead of SQLite. |
| `PIWI_DATABASE_PATH` | `.data/piwi.db` | SQLite database path (ignored when `PIWI_DATABASE_URL` is set) |

## Building locally

::: code-group

```bash [Linux / macOS]
cd application
docker build -t piwi-dashboard:local .
docker run -p 3000:3000 -v $(pwd)/.data:/app/.data piwi-dashboard:local
```

```powershell [Windows (PowerShell)]
cd application
docker build -t piwi-dashboard:local .
docker run -p 3000:3000 -v ${PWD}/.data:/app/.data piwi-dashboard:local
```

:::

## Docker Compose

Create a `docker-compose.yml`:

```yaml
services:
  piwi-dashboard:
    image: ghcr.io/piwitests/dashboard:latest
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
    image: ghcr.io/piwitests/dashboard:latest
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
        image: ghcr.io/piwitests/dashboard:latest
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
- Set a strong `PIWI_SECRET_KEY` (`node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`, or `openssl rand -hex 32`) to encrypt secrets at rest
- Set a strong `PIWI_AUTH_SECRET` and enable authentication for multi-user deployments

## Troubleshooting

### Permission issues with volumes

On **Linux hosts**, the bind-mounted directory must be writable by the container's UID 1001:

```bash
mkdir -p .data
chmod 777 .data
docker run -p 3000:3000 -v $(pwd)/.data:/app/.data ghcr.io/piwitests/dashboard:latest
```

> On Windows and macOS, Docker Desktop manages volume permissions automatically — no `chmod` is needed. Just run the container with `-v ${PWD}/.data:/app/.data` (PowerShell).

### Database locked

SQLite doesn't support concurrent writes well. For high-concurrency deployments, run a single instance or switch to PostgreSQL by setting `PIWI_DATABASE_URL`.

### Port already in use

Map to a different host port:

::: code-group

```bash [Linux / macOS]
docker run -p 8080:3000 -v $(pwd)/.data:/app/.data ghcr.io/piwitests/dashboard:latest
```

```powershell [Windows (PowerShell)]
docker run -p 8080:3000 -v ${PWD}/.data:/app/.data ghcr.io/piwitests/dashboard:latest
```

:::

The dashboard will be available at `http://localhost:8080`.
