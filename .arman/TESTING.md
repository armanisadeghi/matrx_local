No Docker, no local PostgreSQL. Here's the complete guide for you:

---

## Running the Scraper Service -- Step by Step

### 1. Run the Tests (No Database Required)

The integration tests use mocked dependencies so they work right now with zero setup:

```bash
cd /home/arman/projects/ai-dream/scraper-service
uv run pytest tests/ -v
```

All 14 tests pass. This validates every API endpoint, auth, SSE streaming, input validation, and the orchestration pipeline against mocked fetcher/cache/search.

---

### 2. Set Up PostgreSQL (Required for Live Server)

You need a PostgreSQL 17 instance. Pick one of these options:

**Option A: Docker (recommended, but needs Docker Desktop WSL integration enabled)**

Open Docker Desktop on Windows, go to Settings > Resources > WSL Integration, enable it for your distro. Then:

```bash
cd /home/arman/projects/ai-dream/scraper-service
docker compose up -d postgres
```

This starts Postgres on port `5433` with user `scraper`, password `scraper`, database `scraper_service`.

**Option B: Install PostgreSQL locally in WSL**

```bash
sudo apt update && sudo apt install -y postgresql postgresql-client
sudo service postgresql start
sudo -u postgres psql -c "CREATE USER scraper WITH PASSWORD 'scraper';"
sudo -u postgres psql -c "CREATE DATABASE scraper_service OWNER scraper;"
```

Note: local PostgreSQL listens on port `5432` by default, so you'd update the `.env` to use port `5432` instead of `5433`.

**Option C: Use an existing Supabase/remote Postgres**

Just set the `DATABASE_URL` in your `.env` accordingly.

---

### 3. Create the `.env` File

```bash
cd /home/arman/projects/ai-dream/scraper-service
cp .env.example .env
```

Then edit `.env` and fill in at minimum:

```
API_KEY=any-secret-key-you-choose
DATABASE_URL=postgresql://scraper:scraper@localhost:5433/scraper_service
BRAVE_API_KEY=your-actual-brave-api-key
```

Adjust the port to `5432` if using local PostgreSQL (Option B).

---

### 4. Run Database Migrations

```bash
cd /home/arman/projects/ai-dream/scraper-service
uv run alembic upgrade head
```

This creates all 7 tables (`scrape_domain`, `scrape_domain_settings`, `scrape_path_pattern`, `scrape_path_override`, `scrape_base_config`, `scrape_parsed_page`, `scrape_failure_log`).

---

### 5. Install Playwright Browser

```bash
cd /home/arman/projects/ai-dream/scraper-service
uv run playwright install chromium
uv run playwright install-deps chromium
```

The second command installs system libraries Chromium needs. If it fails due to permissions, prefix with `sudo`.

---

### 6. Start the Server

```bash
cd /home/arman/projects/ai-dream/scraper-service
uv run python -m app.main
```

The server starts on `http://0.0.0.0:8001` with hot reload enabled.

---

### 7. Test It Live

**Health check (no auth):**

```bash
curl http://localhost:8001/api/v1/health
```

Expected: `{"status":"ok","db":"connected"}`

**Scrape a page:**

```bash
curl -X POST http://localhost:8001/api/v1/scrape \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"urls": ["https://example.com"]}'
```

**Scrape with SSE streaming:**

```bash
curl -X POST http://localhost:8001/api/v1/scrape/stream \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"urls": ["https://example.com", "https://httpbin.org/html"]}' \
  -N
```

The `-N` flag disables buffering so you see SSE events in real time.

**Search (requires valid Brave API key):**

```bash
curl -X POST http://localhost:8001/api/v1/search \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"keywords": ["python web scraping 2026"]}'
```

**Deep research (SSE stream):**

```bash
curl -X POST http://localhost:8001/api/v1/research \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"query": "best practices for web scraping in 2026", "effort": "low"}' \
  -N
```

Use `"effort": "low"` (10 URLs) for a quick test. `"extreme"` does up to 100.

**Interactive API docs:**

Open `http://localhost:8001/docs` in your browser for the full Swagger UI where you can test every endpoint interactively.

---

### Quick Reference

| What | Command |
|------|---------|
| Run tests (no deps needed) | `uv run pytest tests/ -v` |
| Start Postgres | `docker compose up -d postgres` |
| Run migrations | `uv run alembic upgrade head` |
| Start server | `uv run python -m app.main` |
| API docs | `http://localhost:8001/docs` |
| Health check | `curl http://localhost:8001/api/v1/health` |

The fastest path to seeing it work: step 1 runs the tests immediately with everything mocked. Steps 2-7 give you the full live system.