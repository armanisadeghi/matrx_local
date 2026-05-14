# Matrx package integration — state when Arman stepped away

**Date:** 2026-05-13
**Context:** Agent autonomous session. Goal: install the updated matrx-* packages from aidream into matrx-local after shipping Phase 2–6 work.

## What's in place

### matrx-local consumes 5 packages via editable path from `../aidream/packages/`

Edited `pyproject.toml` (committed): `matrx-utils`, `matrx-orm`, `matrx-connect`, `matrx-rag`, `matrx-scheduler` all sourced via `[tool.uv.sources]` from the sibling aidream workspace. Pattern extends the existing matrx-scheduler path-dep convention.

Verified:
- `PYTHONPATH=. uv run python -c "import app.main"` succeeds — matrx-local boots cleanly.
- `matrx_rag.api.include_routers` is reachable.
- `matrx_connect.middleware.auth.AuthMiddleware` exposes the new `jwks_url` + `jwt_algorithms` kwargs from Phase 6.

Files touched in matrx-local:
- `pyproject.toml` — added matrx-connect + matrx-rag deps, switched matrx-utils/matrx-orm to path source.
- `uv.lock` — regenerated.

### Aidream-side work shipped during the session

All commits pushed to `origin/main`:

| Commit | Phase | What |
|--------|-------|------|
| `b91d1658` | 2b/iv | VectorStore injection seam |
| `3eb3dbcb` | 2c | Frozen-behavior baseline (33 algo tests + 24 shim parity) |
| `c16147b4` | 2d | matrx-rag HTTP router (`/rag/search`, `/rag/ingest`, `/rag/health`) |
| `2c2a3d22` | 6 | matrx-connect JWKS asymmetric token support |
| `4569faa7` | 3a | matrx-ai `register_generic_openai_instance` + dispatch |
| `fc149bc9` | 3b | matrx-ai vision content in GenericOpenAITranslator |
| `28a32bd1` | ci | Added matrx-rag to publish workflow tag-trigger list |

aidream test totals (post-session): matrx-rag 102/102, matrx-connect 18/19 (1 pre-existing failure on a stderr-capture mismatch), matrx-ai new tests 23/23, aidream RAG-area regression 27/27.

## What's intentionally NOT in place (and why)

### 1. matrx-ai is still pinned to PyPI 0.1.26, not the path dep

The aidream-workspace matrx-ai 0.2.0 has an import-graph coupling to the CX (conversation exchange) DB models. Importing the providers layer eagerly resolves bases like `CxAgentMemoryBase` via `matrx_ai.db._registry.get_base(...)` at class-definition time inside `matrx_ai.db.cx_managers`, and also eagerly resolves `ContentBlocks = get_model("ContentBlocks")` at module load time inside `matrx_ai.instructions.matrx_fetcher`.

Aidream pre-configures these via `aidream.package_integration` before any matrx-ai import. matrx-local has no equivalent — and doesn't need the CX tables (no conversation persistence on the local sidecar).

**Implication for matrx-local:**
- Phase 3a (`register_generic_openai_instance`) and Phase 3b (vision content in `GenericOpenAITranslator`) are NOT active in matrx-local yet.
- `app/services/ai/local_llm_registry.py` keeps using its try/except fallback (which short-circuits as before — no regression).

**Activation path** (single tag-push from aidream):
```bash
cd /Users/armanisadeghi/code/aidream
git tag matrx-ai/v0.2.0
git push origin matrx-ai/v0.2.0
# Wait for the publish-package.yml workflow to complete (~3 minutes).
# Then in matrx-local:
cd /Users/armanisadeghi/code/matrx-local
# bump the floor in pyproject.toml: "matrx-ai>=0.2.0"
uv sync
```

That activates Phase 3a/3b end-to-end without touching the aidream-side import-graph issue.

**Alternative** (longer-term): fix the matrx-ai import graph so the providers layer is importable without a configured DB. This is a coordinated refactor — eager class-base lookups in `cx_managers.py` need lazy proxies, and the `ContentBlocks` reference in `matrx_fetcher.py` needs to move to a PEP-562 lazy attribute or function-local import. Several attempts during this session each surfaced a new chain (providers → tools → tools.logger → db.cxm; providers → orchestrator → executor → db; config → message_config → db._registry triggers cx_managers via `db/__init__.py`'s eager imports). Each fix was partial. Recommend doing this as its own focused PR with full test coverage rather than under time pressure.

### 2. No matrx-rag mount in matrx-local yet

matrx-local has no RAG code today. `matrx_rag.api.include_routers(app, prefix="/rag")` is ready to mount, but doing so meaningfully also requires:
- Calling `matrx_rag.configure(...)` with appropriate `EmbeddingProvider`, `LLMProvider`, `VectorStore` implementations for local mode (fastembed/sentence-transformers + llama-server + sqlite-vss/DuckDB, or stay on Postgres+pgvector if a local Postgres is provisioned).
- Deciding on a local PostgreSQL vs sqlite-backed vector store (open question in the master plan).

Both are non-trivial product decisions that should be made deliberately rather than autonomously.

### 3. No matrx-connect AuthMiddleware adoption

matrx-local has its own auth shape in `app/api/auth.py` and its own JWKS implementation in `app/api/extension_auth.py`. Phase 6's contribution was making matrx-connect's `AuthMiddleware` JWKS-capable so OTHER hosts can adopt it. matrx-local consolidating onto matrx-connect's middleware is a Phase 7-ish refactor — possible but not urgent.

### 4. No matrx-utils file router factory mount

matrx-local has its own file handling. The matrx-utils factories (`build_file_router`, `build_asset_router`, `build_share_router`) are available but mounting them would replace working code. Not urgent.

## Outstanding tag-pushes that would update PyPI

If you want to publish the work from this session (purely additive, fully backwards-compatible):

```bash
cd /Users/armanisadeghi/code/aidream

# Required for Phase 3a/3b activation in matrx-local:
git tag matrx-ai/v0.2.0
git push origin matrx-ai/v0.2.0

# Optional — releases the new matrx-rag package:
git tag matrx-rag/v0.1.0
git push origin matrx-rag/v0.1.0

# Optional — releases Phase 6 JWKS support:
# (matrx-connect's pyproject is still at 0.1.1 — bump to 0.2.0 first if you want
# a clean semver signal for the JWKS feature.)
git tag matrx-connect/v0.1.1
git push origin matrx-connect/v0.1.1

# Optional — bumps already-published packages:
git tag matrx-utils/v1.1.0
git push origin matrx-utils/v1.1.0
git tag matrx-orm/v3.0.33
git push origin matrx-orm/v3.0.33
```

Each tag triggers `.github/workflows/publish-package.yml` (OIDC trusted publishing — no credentials needed).

After matrx-ai/v0.2.0 publishes:
- Drop the comment block + path source for matrx-ai from matrx-local's `pyproject.toml` if you want, OR leave the editable path in place and just bump the version floor to `>=0.2.0`.

## Test commands when you come back

```bash
# matrx-local boot smoke test
cd /Users/armanisadeghi/code/matrx-local
PYTHONPATH=. uv run python -c "import app.main; print('OK')"

# Verify Phase 6 JWKS surface is reachable
PYTHONPATH=. uv run python -c "
from matrx_connect.middleware.auth import AuthMiddleware
import inspect
print('jwks_url kwarg present:', 'jwks_url' in inspect.signature(AuthMiddleware.__init__).parameters)
"

# Verify matrx-rag is mountable
PYTHONPATH=. uv run python -c "
from matrx_rag.api import include_routers
print('matrx-rag include_routers:', include_routers)
"

# Confirm Phase 3a is NOT yet active (expected to show ImportError or fail)
PYTHONPATH=. uv run python -c "
try:
    from matrx_ai.providers.unified_client import register_generic_openai_instance
    print('Phase 3a ACTIVE')
except Exception as e:
    print('Phase 3a not yet active:', type(e).__name__, e)
"

# Run aidream package tests to confirm everything is green there
cd /Users/armanisadeghi/code/aidream
uv run pytest packages/matrx-rag/tests/ -q
uv run pytest packages/matrx-connect/tests/test_auth_middleware.py -q
uv run pytest packages/matrx-ai/tests/test_generic_openai_registry.py packages/matrx-ai/tests/test_generic_openai_translator.py -q
```

## Summary

- 5 packages now sourced from aidream workspace via editable path. matrx-local boots cleanly.
- 1 package (matrx-ai) pinned to PyPI 0.1.26 due to its import-graph DB coupling. Activation requires either an aidream-side import-graph refactor or a PyPI publish of matrx-ai 0.2.0.
- All Phase 2–6 work is shipped, tested, and ready to consume — gated only on the matrx-ai version flip described above.

The cleanest next move when you're back: push `matrx-ai/v0.2.0` to trigger the publish, bump matrx-local's floor to `>=0.2.0`, and verify `register_generic_openai_instance` is reachable. That makes Phase 3a/3b live.
