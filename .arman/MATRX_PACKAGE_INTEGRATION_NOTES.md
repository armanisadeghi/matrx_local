# Matrx package integration — state as of 2026-05-17

**Context:** Integration of the aidream-side matrx-* package work into matrx-local. First CI build attempt revealed path-dep approach doesn't work on GitHub Actions runners; this doc reflects the corrected plan.

## What CI sees right now

After commit `c1b0adda` (release v1.3.86) which still had the broken path sources, CI fails on `uv sync`:

```
error: Distribution not found at: file:///Users/runner/work/matrx-local/aidream/packages/matrx-utils
```

`uv` tries to follow the `[tool.uv.sources]` path dep to `../aidream/packages/`, which doesn't exist on the runner. CI only checks out matrx-local, not aidream.

**The fix (this commit):** revert path sources for matrx-utils / matrx-orm / matrx-connect / matrx-rag; drop matrx-connect + matrx-rag from deps (not imported by matrx-local code yet); leave the matrx-scheduler path source in place with a loud CI-WARNING comment because matrx-local DOES import matrx-scheduler — and it has been path-only since `53f96eb3` (pre-existing CI break, predates this session).

The PROPER fix for matrx-scheduler is a PyPI publish, which is gated on a one-time PyPI Trusted Publisher configuration. See "Publishing checklist" below.

## PyPI publish status (verified 2026-05-17)

| Package | aidream pyproject | PyPI latest | Trusted Publisher | Workflow tag pattern |
|---------|-------------------|-------------|--------------------|----------------------|
| matrx-utils | 1.1.0 | 1.0.19 ✓ | ✓ (existing) | ✓ `matrx-utils/v*.*.*` |
| matrx-orm | 3.0.33 | 3.0.32 ✓ | ✓ (existing) | ✓ `matrx-orm/v*.*.*` |
| matrx-ai | 0.2.0 | 0.1.26 ✓ | ✓ (existing) | ✓ `matrx-ai/v*.*.*` ⚠ |
| matrx-connect | 0.1.1 | **not published** | **NEEDS SETUP** | ✓ `matrx-connect/v*.*.*` |
| matrx-rag | 0.1.0 | **not published** | **NEEDS SETUP** | ✓ `matrx-rag/v*.*.*` |
| matrx-scheduler | 0.3.0 | **not published** | **NEEDS SETUP** | ✓ `matrx-scheduler/v*.*.*` (added 2026-05-17) |
| matrx-scraper | 0.1.0 | **not published** | **NEEDS SETUP** | ✓ `matrx-scraper/v*.*.*` |

⚠ **matrx-ai 0.2.0 caveat:** publishing 0.2.0 to PyPI is technically possible but would break any fresh consumer because of an import-graph DB coupling (eager `get_base` / `get_model` lookups in `matrx_ai.db.cx_managers` + `matrx_ai.instructions.matrx_fetcher` require a host to call `matrx_ai.configure_db(...)` before importing). Aidream pre-configures this; matrx-local does not. Recommend NOT publishing 0.2.0 until the import graph is lazified.

## What MUST happen before matrx-local CI builds successfully

Exactly one thing: **publish matrx-scheduler 0.3.0 to PyPI**, then drop the path source from matrx-local pyproject.toml.

### Step-by-step

**1. Configure PyPI Trusted Publisher for matrx-scheduler (one-time, manual)**

Go to https://pypi.org/manage/account/publishing/ (signed in as a project owner) and add a "Pending Publisher":

- PyPI Project Name: `matrx-scheduler`
- Owner: `AI-Matrix-Engine`
- Repository name: `aidream`
- Workflow name: `publish-package.yml`
- Environment name: (leave empty, unless your workflow declares one)

This must be done BEFORE the first tag push. PyPI provides a checklist confirmation page.

**2. Push the tag from aidream**

```bash
cd /Users/armanisadeghi/code/aidream
git fetch origin
git checkout main && git pull
# matrx-scheduler's pyproject.toml already says version = "0.3.0"
git tag matrx-scheduler/v0.3.0
git push origin matrx-scheduler/v0.3.0
```

The publish-package.yml workflow at `aidream/.github/workflows/publish-package.yml` will:
- Parse the tag → package name + version
- Verify `packages/matrx-scheduler/pyproject.toml` version matches
- `uv build` the package
- `pypa/gh-action-pypi-publish` uploads via OIDC

Watch the run at: `https://github.com/AI-Matrix-Engine/aidream/actions/workflows/publish-package.yml`.

**3. Update matrx-local pyproject.toml**

Once the publish succeeds and `pip install matrx-scheduler==0.3.0` works from PyPI:

```toml
# In matrx-local/pyproject.toml [project.dependencies], change:
"matrx-scheduler",
# To:
"matrx-scheduler>=0.3.0",

# And DELETE the entire [tool.uv.sources] block (or just the
# matrx-scheduler line if you want to keep the comment).
```

Then `uv sync && git commit -m "deps: pin matrx-scheduler to PyPI v0.3.0" && git push`.

CI builds will now succeed.

## Optional follow-ups (when you're ready)

### Publish matrx-rag 0.1.0 + matrx-connect 0.1.1

Same Trusted Publisher dance, then:

```bash
git tag matrx-rag/v0.1.0 && git push origin matrx-rag/v0.1.0
git tag matrx-connect/v0.1.1 && git push origin matrx-connect/v0.1.1
```

These don't unblock matrx-local CI today (the deps were removed from matrx-local), but you'll want them on PyPI before matrx-local starts mounting matrx-rag's router or consolidating onto matrx-connect's AuthMiddleware.

### Bump matrx-utils / matrx-orm to ship existing aidream gains

aidream-workspace matrx-utils is at 1.1.0 (vs PyPI 1.0.19); matrx-orm at 3.0.33 (vs 3.0.32). Both publishable with no caveats:

```bash
git tag matrx-utils/v1.1.0 && git push origin matrx-utils/v1.1.0
git tag matrx-orm/v3.0.33 && git push origin matrx-orm/v3.0.33
```

After publish, matrx-local's `>=1.0.19` / `>=3.0.32` floors will resolve to the new versions automatically on the next `uv sync`.

### Skip publishing matrx-ai 0.2.0 for now

See the caveat above — the import graph needs a lazy refactor first. Phase 3a/3b features (`register_generic_openai_instance` + vision content) stay in aidream-only mode until that's done. matrx-local's `local_llm_registry.py` continues to no-op via its try/except (no regression).

## Aidream-side work from this multi-day session

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
| (this session) | ci | Added matrx-scheduler to publish workflow tag-trigger list |

Test totals (post-session): matrx-rag 102/102, matrx-connect 18/19 (1 pre-existing failure on stderr/stdout capture mismatch — not related to this work), matrx-ai new tests 23/23, aidream RAG-area regression 27/27.

## Summary

- **CI breakage is fixed in this commit** by reverting the path sources. matrx-local boots locally and CI will get further than before (the matrx-scheduler path source is still there, with a loud CI-WARNING comment — that's the pre-existing issue from `53f96eb3` that this session can't unilaterally fix without your PyPI Trusted Publisher setup action).
- **To make matrx-local CI fully green:** configure PyPI Trusted Publisher for matrx-scheduler (link above), push tag `matrx-scheduler/v0.3.0`, drop the path source.
- **Phase 3a/3b activation in matrx-local:** still gated on a clean way to consume matrx-ai 0.2.0 (either fix the import graph or skip the version). Not urgent — current matrx-local `local_llm_registry.py` no-ops gracefully.
