FROM python:3.12-slim AS base

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    libgl1 \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

COPY pyproject.toml uv.lock* ./
RUN uv sync --frozen --no-dev --no-editable 2>/dev/null || uv sync --no-dev --no-editable

RUN uv run playwright install chromium \
    && uv run playwright install-deps chromium

COPY alembic.ini ./alembic.ini
COPY alembic/ ./alembic/
COPY app/ ./app/
COPY scripts/ ./scripts/

RUN chmod +x /app/scripts/entrypoint.sh

EXPOSE 8001

ENTRYPOINT ["/app/scripts/entrypoint.sh"]
CMD ["uv", "run", "uvicorn", "app.main:create_app", "--factory", "--host", "0.0.0.0", "--port", "8001"]
