# Python minor version of the dependency and runtime images
ARG PYTHON_VERSION=3.14

# Frontend build
FROM dhi.io/node:26.13.1-debian13-sfw-dev AS frontend-builder

ARG APP_VERSION

WORKDIR /app/frontend

ENV VITE_APP_VERSION="$APP_VERSION"

COPY frontend/package.json frontend/package-lock.json frontend/.npmrc ./
RUN npm ci

COPY frontend/index.html frontend/postcss.config.js frontend/tailwind.config.js frontend/tsconfig.app.json frontend/tsconfig.node.json frontend/vite.config.ts ./

# App-only TypeScript config
COPY frontend/tsconfig.app.json ./tsconfig.json
COPY frontend/public ./public
COPY frontend/src ./src
RUN npm run build:app


# Backend dependencies
FROM dhi.io/python:${PYTHON_VERSION}-debian13-sfw-dev AS backend-deps

# The same uv as the setup-uv steps in the backend workflows, so a relock anywhere writes one lockfile format
ARG UV_VERSION=0.13.7

WORKDIR /app/backend

ENV PATH="/opt/uv/bin:$PATH"
ENV UV_LINK_MODE=copy
ENV UV_PYTHON_DOWNLOADS=never

RUN python -m venv /opt/uv \
    && /opt/uv/bin/pip install --no-cache-dir "uv==${UV_VERSION}"

COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project


# Caddy binary
FROM dhi.io/caddy:2-debian13-dev AS caddy


# Runtime image, with no shell, package manager or build tools. OpenSSL and the CA certificates come with it
FROM dhi.io/python:${PYTHON_VERSION}-debian13 AS runtime

ARG APP_VERSION

ENV PATH="/app/backend/.venv/bin:$PATH"
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV APP_VERSION="$APP_VERSION"
ENV UPDATE_CHECKS_ENABLED=true

WORKDIR /app/backend

# Starts as root only to hand the data volume to the base image's unprivileged user. The
# entrypoint then becomes that user. A volume an earlier image wrote as root keeps working after an upgrade. Named
# by number, since the base image lists no root user
USER 0:0

# The base image's own pip, the one package manager it ships, removed without a shell
RUN ["/usr/bin/python3", "-m", "pip", "uninstall", "--yes", "--break-system-packages", "pip"]

# Built frontend and dependencies
COPY --from=caddy /usr/local/bin/caddy /usr/local/bin/caddy
COPY --from=backend-deps /app/backend/.venv /app/backend/.venv
COPY --from=frontend-builder /app/frontend/dist /srv/lumina/frontend

# Backend source, migrations and seed scripts
COPY backend/alembic ./alembic
COPY backend/alembic.ini ./
COPY backend/app ./app
COPY backend/scripts ./scripts

# Runtime configuration
COPY docker/Caddyfile /etc/caddy/Caddyfile
COPY docker/entrypoint.py /usr/local/bin/entrypoint.py

EXPOSE 80
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD ["python", "-c", "import json, urllib.request; assert json.load(urllib.request.urlopen('http://127.0.0.1/api/health', timeout=10)).get('status') == 'ok'"]

ENTRYPOINT ["python", "/usr/local/bin/entrypoint.py"]
