"""Hugging Face token acquisition assistant.

Drives a real browser (via Playwright) to open Hugging Face at the right page,
pre-fill the new-token form, and extract the generated token — returning it
directly to the UI so the user never has to copy/paste.

Fully graceful: every step is try/except'd.  If anything fails (Playwright not
installed, no display, page layout changed, network error, user closes the
window) we return  {"status": "manual"}  and the UI falls back to its
step-by-step manual instructions.  The user never sees an error from this route.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/hf-token", tags=["hf-token"])


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------


class HfAssistRequest(BaseModel):
    has_account: bool = True
    """True  → navigate straight to token creation page.
    False → navigate to signup page first."""


class HfAssistResponse(BaseModel):
    status: Literal["opened", "token_ready", "manual"]
    """
    opened      – browser opened and is at the right page (user may need to interact)
    token_ready – we extracted the generated token automatically
    manual      – Playwright unavailable or something failed; UI should show manual steps
    """
    token: str | None = None
    """Populated only when status == "token_ready"."""
    reason: str | None = None
    """Human-readable reason when status == "manual" (logged, not shown to user)."""


# ---------------------------------------------------------------------------
# HF page URLs
# ---------------------------------------------------------------------------

_SIGNUP_URL = "https://huggingface.co/join"
_TOKEN_NEW_URL = "https://huggingface.co/settings/tokens/new?tokenType=read"
_TOKEN_PAGE_URL = "https://huggingface.co/settings/tokens"
_LOGIN_URL = "https://huggingface.co/login"


# ---------------------------------------------------------------------------
# Core Playwright flow
# ---------------------------------------------------------------------------


async def _open_hf_browser(has_account: bool) -> HfAssistResponse:
    """
    Attempt to drive a browser to the Hugging Face token page.

    Strategy (all steps wrapped in individual try/except):
      1. Check Playwright is importable and a browser can be launched.
      2. Navigate to signup or token-creation page depending on has_account.
      3. If token-creation page: pre-fill the token name field and click "Create token".
      4. Poll up to 15 s for a token value to appear in the DOM.
      5. Return the token if found, or "opened" if the browser is up but we
         couldn't extract the token, or "manual" on any hard failure.
    """
    # Step 1: Try to import and launch
    try:
        from app.tools.tools.browser_automation import _get_browser, _supports_headed
    except Exception as exc:
        logger.debug("[hf-token] browser_automation import failed: %s", exc)
        return HfAssistResponse(status="manual", reason=f"Import error: {exc}")

    try:
        context = await _get_browser("chromium")
    except Exception as exc:
        logger.debug("[hf-token] _get_browser failed: %s", exc)
        return HfAssistResponse(status="manual", reason=f"Browser launch failed: {exc}")

    if context is None:
        return HfAssistResponse(
            status="manual",
            reason="Playwright browser not available (not installed or no display on this platform).",
        )

    # Step 2: Open the right page
    target_url = _TOKEN_NEW_URL if has_account else _SIGNUP_URL
    try:
        pages = context.pages
        page = pages[-1] if pages else await context.new_page()
        await page.goto(target_url, wait_until="domcontentloaded", timeout=20_000)
        # Bring the window to front so the user can see it
        await page.bring_to_front()
    except Exception as exc:
        logger.debug("[hf-token] Navigation to %s failed: %s", target_url, exc)
        return HfAssistResponse(status="manual", reason=f"Navigation failed: {exc}")

    # Step 3 (token page only): pre-fill the token name and submit
    if has_account:
        try:
            # Wait briefly to check if we're on the login redirect first
            await asyncio.sleep(1.5)
            current = page.url
            if "login" in current or "/join" in current:
                # User needs to sign in first — just leave the browser open at login
                logger.debug("[hf-token] Redirected to login/join — leaving browser open for user")
                return HfAssistResponse(
                    status="opened",
                    reason="Redirected to login — browser is open for user to sign in.",
                )
        except Exception:
            pass

        # Try to fill the token name field
        try:
            name_selector = "input#token-name, input[name='tokenName'], input[placeholder*='name'], input[placeholder*='Name']"
            await page.wait_for_selector(name_selector, timeout=5_000)
            await page.fill(name_selector, "Matrx-Local")
        except Exception:
            # Field not found — page may have changed layout; keep going
            pass

        # Try to select "read" scope radio if not already selected
        try:
            read_radio = "input[value='read'], label:has-text('Read'), button:has-text('Read')"
            el = await page.query_selector(read_radio)
            if el:
                await el.click()
                await asyncio.sleep(0.3)
        except Exception:
            pass

        # Try to click the Create / Submit button
        try:
            submit_selector = (
                "button[type='submit']:not([disabled]), "
                "button:has-text('Create token'), "
                "button:has-text('Generate'), "
                "input[type='submit']"
            )
            btn = await page.query_selector(submit_selector)
            if btn:
                await btn.click()
                await asyncio.sleep(0.5)
        except Exception:
            pass

        # Step 4: Poll up to 15 s for the token to appear in the DOM
        token_value: str | None = None
        for _ in range(15):
            await asyncio.sleep(1)
            try:
                # HF renders the generated token in various ways depending on version;
                # try the most common selectors
                for sel in [
                    "input[type='text'][value^='hf_']",
                    "code:has-text('hf_')",
                    "[data-testid='token-value']",
                    "div.token-value",
                    "span.token",
                    # Generic: any element whose text starts with hf_
                ]:
                    el = await page.query_selector(sel)
                    if el:
                        raw = await el.input_value() if sel.startswith("input") else await el.inner_text()
                        raw = (raw or "").strip()
                        if raw.startswith("hf_") and len(raw) > 10:
                            token_value = raw
                            break

                if not token_value:
                    # Broader scan: any visible text node that looks like hf_*
                    result = await page.evaluate("""() => {
                        const walker = document.createTreeWalker(
                            document.body, NodeFilter.SHOW_TEXT, null
                        );
                        let node;
                        while ((node = walker.nextNode())) {
                            const t = node.textContent.trim();
                            if (t.startsWith('hf_') && t.length > 10 && t.length < 200) {
                                return t;
                            }
                        }
                        return null;
                    }""")
                    if result and isinstance(result, str) and result.startswith("hf_"):
                        token_value = result.strip()

                if token_value:
                    break
            except Exception:
                pass

        if token_value:
            logger.info("[hf-token] Token extracted automatically")
            return HfAssistResponse(status="token_ready", token=token_value)

    # Browser is open, user may need to interact
    logger.debug("[hf-token] Browser opened but token not extracted — returning 'opened'")
    return HfAssistResponse(status="opened")


# ---------------------------------------------------------------------------
# Route
# ---------------------------------------------------------------------------


@router.post("/assist", response_model=HfAssistResponse)
async def hf_token_assist(req: HfAssistRequest) -> HfAssistResponse:
    """
    Open a browser to Hugging Face and attempt to automate token creation.

    Always returns 200. The `status` field tells the UI what happened:
      - "opened"      → browser is open at the right page; user may need to interact
      - "token_ready" → token was extracted; client should auto-fill and save it
      - "manual"      → Playwright unavailable; UI should show manual step-by-step guide
    """
    try:
        return await _open_hf_browser(req.has_account)
    except Exception as exc:
        # Final safety net — never surface a 500 to the UI
        logger.warning("[hf-token] Unhandled exception in assist flow: %s", exc, exc_info=True)
        return HfAssistResponse(status="manual", reason=str(exc))
