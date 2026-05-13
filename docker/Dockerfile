# Build the Vite frontend into static assets.
FROM node:24-bookworm-slim AS frontend-builder

WORKDIR /app/frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/index.html frontend/postcss.config.js frontend/tailwind.config.js frontend/tsconfig.app.json frontend/tsconfig.json frontend/tsconfig.node.json frontend/vite.config.ts ./
COPY frontend/src ./src
COPY frontend/styles ./styles
RUN npm run build


# Install locked Python production dependencies into a virtualenv.
FROM ghcr.io/astral-sh/uv:python3.14-bookworm-slim AS backend-deps

WORKDIR /app/backend

ENV UV_COMPILE_BYTECODE=1
ENV UV_LINK_MODE=copy

COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project


# Source the Caddy binary for the final image.
FROM caddy:2 AS caddy


# Assemble the final one-image runtime.
FROM python:3.14-slim AS runtime

ENV PATH="/app/backend/.venv/bin:$PATH"
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV RUNTIME=server

WORKDIR /app/backend

# Add only the small OS packages the entrypoint/runtime need.
RUN apt-get update \
    && apt-get install -y --no-install-recommends bash ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/*

# Copy built artifacts and runtime dependencies from prior stages.
COPY --from=caddy /usr/bin/caddy /usr/bin/caddy
COPY --from=backend-deps /app/backend/.venv /app/backend/.venv
COPY --from=frontend-builder /app/frontend/dist /srv/lumina/frontend

# Copy backend source, migrations, and seed scripts.
COPY backend/alembic ./alembic
COPY backend/alembic.ini ./
COPY backend/app ./app
COPY backend/scripts ./scripts

# Copy self-hosted runtime configuration.
COPY docker/Caddyfile /etc/caddy/Caddyfile
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh

RUN chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 80
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import json, urllib.request; assert json.load(urllib.request.urlopen('http://127.0.0.1/api/health', timeout=10)).get('status') == 'ok'"

ENTRYPOINT ["entrypoint.sh"]
