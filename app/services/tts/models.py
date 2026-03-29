"""Kokoro TTS voice catalog.

Curated list of all 54 built-in voices from Kokoro v1.0, organised by
language.  Each entry is self-describing so the router and UI can derive
all display / filtering / playback information without hardcoded strings.

Voice quality grades are sourced from the official VOICES.md on HuggingFace.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal


@dataclass(frozen=True)
class TtsVoice:
    """A single TTS voice entry."""

    voice_id: str
    """Kokoro voice identifier (e.g. 'af_heart')."""

    name: str
    """Human-readable display name."""

    gender: Literal["female", "male"]

    language: str
    """Full language label (e.g. 'American English')."""

    lang_code: str
    """Kokoro lang_code used in KPipeline / kokoro-onnx (e.g. 'a')."""

    quality_grade: str
    """Official quality grade from VOICES.md (e.g. 'A', 'B-', 'C+')."""

    traits: list[str] = field(default_factory=list)
    """Optional UI-facing tags (e.g. ['flagship', 'warm'])."""

    is_custom: bool = False
    is_default: bool = False


# ── Language metadata ─────────────────────────────────────────────────────────

@dataclass(frozen=True)
class TtsLanguage:
    lang_code: str
    name: str
    flag: str
    espeak_fallback: str


LANGUAGES: list[TtsLanguage] = [
    TtsLanguage(lang_code="a", name="American English", flag="us", espeak_fallback="en-us"),
    TtsLanguage(lang_code="b", name="British English", flag="gb", espeak_fallback="en-gb"),
    TtsLanguage(lang_code="j", name="Japanese", flag="jp", espeak_fallback="ja"),
    TtsLanguage(lang_code="z", name="Mandarin Chinese", flag="cn", espeak_fallback="cmn"),
    TtsLanguage(lang_code="e", name="Spanish", flag="es", espeak_fallback="es"),
    TtsLanguage(lang_code="f", name="French", flag="fr", espeak_fallback="fr-fr"),
    TtsLanguage(lang_code="h", name="Hindi", flag="in", espeak_fallback="hi"),
    TtsLanguage(lang_code="i", name="Italian", flag="it", espeak_fallback="it"),
    TtsLanguage(lang_code="p", name="Brazilian Portuguese", flag="br", espeak_fallback="pt-br"),
]

LANGUAGE_MAP: dict[str, TtsLanguage] = {lang.lang_code: lang for lang in LANGUAGES}


# ── Voice catalog ─────────────────────────────────────────────────────────────

BUILTIN_VOICES: list[TtsVoice] = [
    # ── American English (lang_code='a') ──────────────────────────────────────
    TtsVoice(voice_id="af_heart",   name="Heart",   gender="female", language="American English", lang_code="a", quality_grade="A",  traits=["flagship"], is_default=True),
    TtsVoice(voice_id="af_bella",   name="Bella",   gender="female", language="American English", lang_code="a", quality_grade="A-", traits=["warm"]),
    TtsVoice(voice_id="af_nicole",  name="Nicole",  gender="female", language="American English", lang_code="a", quality_grade="B-"),
    TtsVoice(voice_id="af_aoede",   name="Aoede",   gender="female", language="American English", lang_code="a", quality_grade="C+"),
    TtsVoice(voice_id="af_kore",    name="Kore",    gender="female", language="American English", lang_code="a", quality_grade="C+"),
    TtsVoice(voice_id="af_sarah",   name="Sarah",   gender="female", language="American English", lang_code="a", quality_grade="C+"),
    TtsVoice(voice_id="af_alloy",   name="Alloy",   gender="female", language="American English", lang_code="a", quality_grade="C"),
    TtsVoice(voice_id="af_nova",    name="Nova",    gender="female", language="American English", lang_code="a", quality_grade="C"),
    TtsVoice(voice_id="af_jessica", name="Jessica", gender="female", language="American English", lang_code="a", quality_grade="D"),
    TtsVoice(voice_id="af_river",   name="River",   gender="female", language="American English", lang_code="a", quality_grade="D"),
    TtsVoice(voice_id="af_sky",     name="Sky",     gender="female", language="American English", lang_code="a", quality_grade="C-"),
    TtsVoice(voice_id="am_fenrir",  name="Fenrir",  gender="male",   language="American English", lang_code="a", quality_grade="C+"),
    TtsVoice(voice_id="am_michael", name="Michael", gender="male",   language="American English", lang_code="a", quality_grade="C+"),
    TtsVoice(voice_id="am_puck",    name="Puck",    gender="male",   language="American English", lang_code="a", quality_grade="C+"),
    TtsVoice(voice_id="am_adam",    name="Adam",    gender="male",   language="American English", lang_code="a", quality_grade="F+"),
    TtsVoice(voice_id="am_echo",    name="Echo",    gender="male",   language="American English", lang_code="a", quality_grade="D"),
    TtsVoice(voice_id="am_eric",    name="Eric",    gender="male",   language="American English", lang_code="a", quality_grade="D"),
    TtsVoice(voice_id="am_liam",    name="Liam",    gender="male",   language="American English", lang_code="a", quality_grade="D"),
    TtsVoice(voice_id="am_onyx",    name="Onyx",    gender="male",   language="American English", lang_code="a", quality_grade="D"),
    TtsVoice(voice_id="am_santa",   name="Santa",   gender="male",   language="American English", lang_code="a", quality_grade="D-"),

    # ── British English (lang_code='b') ───────────────────────────────────────
    TtsVoice(voice_id="bf_alice",    name="Alice",    gender="female", language="British English", lang_code="b", quality_grade="D"),
    TtsVoice(voice_id="bf_emma",     name="Emma",     gender="female", language="British English", lang_code="b", quality_grade="B-"),
    TtsVoice(voice_id="bf_isabella", name="Isabella", gender="female", language="British English", lang_code="b", quality_grade="C"),
    TtsVoice(voice_id="bf_lily",     name="Lily",     gender="female", language="British English", lang_code="b", quality_grade="D"),
    TtsVoice(voice_id="bm_daniel",   name="Daniel",   gender="male",   language="British English", lang_code="b", quality_grade="D"),
    TtsVoice(voice_id="bm_fable",    name="Fable",    gender="male",   language="British English", lang_code="b", quality_grade="C"),
    TtsVoice(voice_id="bm_george",   name="George",   gender="male",   language="British English", lang_code="b", quality_grade="C"),
    TtsVoice(voice_id="bm_lewis",    name="Lewis",    gender="male",   language="British English", lang_code="b", quality_grade="D+"),

    # ── Japanese (lang_code='j') ──────────────────────────────────────────────
    TtsVoice(voice_id="jf_alpha",      name="Alpha",      gender="female", language="Japanese", lang_code="j", quality_grade="C+"),
    TtsVoice(voice_id="jf_gongitsune", name="Gongitsune", gender="female", language="Japanese", lang_code="j", quality_grade="C"),
    TtsVoice(voice_id="jf_nezumi",     name="Nezumi",     gender="female", language="Japanese", lang_code="j", quality_grade="C-"),
    TtsVoice(voice_id="jf_tebukuro",   name="Tebukuro",   gender="female", language="Japanese", lang_code="j", quality_grade="C"),
    TtsVoice(voice_id="jm_kumo",       name="Kumo",       gender="male",   language="Japanese", lang_code="j", quality_grade="C-"),

    # ── Mandarin Chinese (lang_code='z') ──────────────────────────────────────
    TtsVoice(voice_id="zf_xiaobei",  name="Xiaobei",  gender="female", language="Mandarin Chinese", lang_code="z", quality_grade="D"),
    TtsVoice(voice_id="zf_xiaoni",   name="Xiaoni",   gender="female", language="Mandarin Chinese", lang_code="z", quality_grade="D"),
    TtsVoice(voice_id="zf_xiaoxiao", name="Xiaoxiao", gender="female", language="Mandarin Chinese", lang_code="z", quality_grade="D"),
    TtsVoice(voice_id="zf_xiaoyi",   name="Xiaoyi",   gender="female", language="Mandarin Chinese", lang_code="z", quality_grade="D"),
    TtsVoice(voice_id="zm_yunjian",  name="Yunjian",  gender="male",   language="Mandarin Chinese", lang_code="z", quality_grade="D"),
    TtsVoice(voice_id="zm_yunxi",    name="Yunxi",    gender="male",   language="Mandarin Chinese", lang_code="z", quality_grade="D"),
    TtsVoice(voice_id="zm_yunxia",   name="Yunxia",   gender="male",   language="Mandarin Chinese", lang_code="z", quality_grade="D"),
    TtsVoice(voice_id="zm_yunyang",  name="Yunyang",  gender="male",   language="Mandarin Chinese", lang_code="z", quality_grade="D"),

    # ── Spanish (lang_code='e') ───────────────────────────────────────────────
    TtsVoice(voice_id="ef_dora",  name="Dora",  gender="female", language="Spanish", lang_code="e", quality_grade="C"),
    TtsVoice(voice_id="em_alex",  name="Alex",  gender="male",   language="Spanish", lang_code="e", quality_grade="C"),
    TtsVoice(voice_id="em_santa", name="Santa", gender="male",   language="Spanish", lang_code="e", quality_grade="C"),

    # ── French (lang_code='f') ────────────────────────────────────────────────
    TtsVoice(voice_id="ff_siwis", name="Siwis", gender="female", language="French", lang_code="f", quality_grade="B-"),

    # ── Hindi (lang_code='h') ─────────────────────────────────────────────────
    TtsVoice(voice_id="hf_alpha", name="Alpha", gender="female", language="Hindi", lang_code="h", quality_grade="C"),
    TtsVoice(voice_id="hf_beta",  name="Beta",  gender="female", language="Hindi", lang_code="h", quality_grade="C"),
    TtsVoice(voice_id="hm_omega", name="Omega", gender="male",   language="Hindi", lang_code="h", quality_grade="C"),
    TtsVoice(voice_id="hm_psi",   name="Psi",   gender="male",   language="Hindi", lang_code="h", quality_grade="C"),

    # ── Italian (lang_code='i') ───────────────────────────────────────────────
    TtsVoice(voice_id="if_sara",   name="Sara",   gender="female", language="Italian", lang_code="i", quality_grade="C"),
    TtsVoice(voice_id="im_nicola", name="Nicola", gender="male",   language="Italian", lang_code="i", quality_grade="C"),

    # ── Brazilian Portuguese (lang_code='p') ──────────────────────────────────
    TtsVoice(voice_id="pf_dora",  name="Dora",  gender="female", language="Brazilian Portuguese", lang_code="p", quality_grade="C"),
    TtsVoice(voice_id="pm_alex",  name="Alex",  gender="male",   language="Brazilian Portuguese", lang_code="p", quality_grade="C"),
    TtsVoice(voice_id="pm_santa", name="Santa", gender="male",   language="Brazilian Portuguese", lang_code="p", quality_grade="C"),
]

VOICE_MAP: dict[str, TtsVoice] = {v.voice_id: v for v in BUILTIN_VOICES}

DEFAULT_VOICE_ID = "af_heart"

# Model file metadata
ONNX_MODEL_FILENAME = "kokoro-v1.0.onnx"
VOICES_BIN_FILENAME = "voices-v1.0.bin"

ONNX_MODEL_URL = (
    "https://github.com/thewh1teagle/kokoro-onnx/releases/download/"
    "model-files-v1.0/kokoro-v1.0.onnx"
)
VOICES_BIN_URL = (
    "https://github.com/thewh1teagle/kokoro-onnx/releases/download/"
    "model-files-v1.0/voices-v1.0.bin"
)

ONNX_MODEL_SIZE_BYTES = 325_532_387  # ~310 MB
VOICES_BIN_SIZE_BYTES = 28_214_398   # ~27 MB

SAMPLE_RATE = 24_000
