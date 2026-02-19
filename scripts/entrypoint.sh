#!/bin/bash
set -e

echo "[entrypoint] Running database migrations..."
uv run alembic upgrade head

echo "[entrypoint] Migrations complete. Starting application..."
exec "$@"
