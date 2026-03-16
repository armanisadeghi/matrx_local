"""Compile-time configuration baked into the PyInstaller binary by the CI build.

In development (uv run), this file is IGNORED — values come from .env instead.
In the production bundle, CI overwrites this file with real values before
PyInstaller packages the code. The runtime hook (hooks/runtime_hook.py) calls
apply() early so os.environ is populated before any other module imports.

HOW IT WORKS
------------
1. CI build-sidecar step runs: python scripts/write_bundled_config.py
   That script reads AIDREAM_SERVER_URL_LIVE / SUPABASE_URL /
   SUPABASE_PUBLISHABLE_KEY from the environment and writes them here.
2. PyInstaller bundles this file as part of the `app` package.
3. runtime_hook.py calls app.bundled_config.apply() before anything else.
4. os.environ now has the correct values — dotenv just confirms they're set.

SECURITY NOTE
-------------
AIDREAM_SERVER_URL_LIVE and SUPABASE_URL are not secrets (they are public
API endpoints). SUPABASE_PUBLISHABLE_KEY is the *publishable* (formerly
anon) key — it is intentionally safe to embed in client binaries because
Row-Level Security enforces access at the database layer.
"""

# These values are replaced by scripts/write_bundled_config.py at build time.
# Defaults are empty strings so missing config fails loudly rather than silently.
AIDREAM_SERVER_URL_LIVE: str = ""
SUPABASE_URL: str = ""
SUPABASE_PUBLISHABLE_KEY: str = ""


def apply() -> None:
    """Inject bundled config into os.environ if not already set.

    Called by hooks/runtime_hook.py before any application import.
    Only sets values that are non-empty and not already in the environment,
    so .env overrides still work in development.
    """
    import os

    _vals = {
        "AIDREAM_SERVER_URL_LIVE": AIDREAM_SERVER_URL_LIVE,
        "SUPABASE_URL": SUPABASE_URL,
        "SUPABASE_PUBLISHABLE_KEY": SUPABASE_PUBLISHABLE_KEY,
    }
    for key, val in _vals.items():
        if val and not os.environ.get(key):
            os.environ[key] = val
