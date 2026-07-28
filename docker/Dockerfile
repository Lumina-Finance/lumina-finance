# Build the Vite frontend into static assets.
FROM dhi.io/node:26-debian13-sfw-dev AS frontend-builder

ARG APP_VERSION

WORKDIR /app/frontend

ENV VITE_APP_VERSION="$APP_VERSION"

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/index.html frontend/postcss.config.js frontend/tailwind.config.js frontend/tsconfig.app.json frontend/tsconfig.node.json frontend/vite.config.ts ./

# Vite reads tsconfig.json during bundling, so Docker uses the app-only config
COPY frontend/tsconfig.app.json ./tsconfig.json
COPY frontend/public ./public
COPY frontend/src ./src
RUN npm run build:app


# Install locked Python production dependencies into a virtualenv.
FROM dhi.io/python:3-debian13-sfw-dev AS backend-deps

ARG UV_VERSION=0.12.0

WORKDIR /app/backend

ENV PATH="/opt/uv/bin:$PATH"
ENV UV_LINK_MODE=copy
ENV UV_PYTHON_DOWNLOADS=never

RUN python -m venv /opt/uv \
    && /opt/uv/bin/pip install --no-cache-dir "uv==${UV_VERSION}"

COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project


# Source the Caddy binary for the final image.
FROM dhi.io/caddy:2-debian13-dev AS caddy


# Assemble the final one-image runtime.
FROM dhi.io/python:3-debian13-dev AS runtime

ARG APP_VERSION

ENV PATH="/app/backend/.venv/bin:$PATH"
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV RUNTIME=server
ENV APP_VERSION="$APP_VERSION"
ENV UPDATE_CHECKS_ENABLED=true

WORKDIR /app/backend

# Add only the small OS packages the entrypoint/runtime need.
RUN apt-get update \
    && apt-get install -y --no-install-recommends bash ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/*

# Copy built artifacts and runtime dependencies from prior stages.
COPY --from=caddy /usr/local/bin/caddy /usr/local/bin/caddy
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
