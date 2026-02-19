from __future__ import annotations

from typing import Any

overrides: list[dict[str, Any]] = [
    {
        "attribute": "role",
        "exact": ["navigation", "banner", "complementary", "menu", "dialog", "menuitem", "figure", "icon", "picture", "toolbar", "menubar"],
        "partial": ["tooltip"],
        "regex": [],
    },
    {
        "attribute": "name",
        "exact": ["header", "footer", "sidebar", "bridged-flipcard-div", "script", "style", "svg", "head", "select", "button", "figure", "fieldset", "form", "section", "mbox-text-span", "sidebar-section"],
        "partial": ["nav"],
        "regex": [],
    },
    {
        "attribute": "class",
        "exact": ["ui-consent-roadblock", "w3-sidebar", "interlanguage-link-target", "breadcrumb", "hidden-xs", "subnav-container", "visually-hidden", "show-comments", "notification-prompt", "newsletter-component", "news-letter-title", "header", "footer", "sidebar", "ad", "menu", "popup", "modal", "google-dfp-ad-wrapper", "TaboolaRecommendationModule", "sr-only", "ad-feedback-link", "share", "social", "advert", "promo", "overlay", "icon", "mbox-text-span", "sidebar-section"],
        "partial": ["text-muted", "share", "social", "advert", "promo", "Promo", "overlay", "modal", "popup", "announcement", "drawer", "size-chart", "size-guide", "cookie", "privacy", "terms", "disclaimer", "copyright", "legal", "product-recommendations", "sidebar-section", "recommendations", "icons", "mw-editsection", "button", "ch-code-line-number", "article__read-next"],
        "regex": [],
    },
    {
        "attribute": "tag",
        "exact": ["label", "iframe", "header", "script", "style", "svg", "head", "nav", "footer", "select", "button", "fieldset", "mbox-text-span", "sidebar-section", "aside", "ps-header", "ps-section-nav", "ps-actionbar", "ps-gift-article-modal", "ps-newsletter-module", "bsp-page-actions", "bsp-header", "noscript", "link"],
        "partial": [],
        "regex": [],
    },
    {
        "attribute": "id",
        "exact": ["success-hint", "success-hint-header", "read-next", "popover-content", "accessibility-banner"],
        "partial": [],
        "regex": [],
    },
    {
        "attribute": "style",
        "exact": ["display:none", "visibility:hidden"],
        "partial": [],
        "regex": [],
    },
    {
        "attribute": "aria-hidden",
        "exact": ["true"],
        "partial": [],
        "regex": [],
    },
    {
        "attribute": "hidden",
        "exact": [""],
        "partial": [],
        "regex": [],
    },
    {
        "attribute": "text",
        "exact": ["Advertisement"],
        "partial": [],
        "regex": [],
    },
]
