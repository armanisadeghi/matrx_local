# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_data_files, collect_dynamic_libs

# espeak-ng: bundled native library + language dictionaries (required by kokoro-onnx TTS)
_espeakng_data = collect_data_files('espeakng_loader')
_espeakng_libs = collect_dynamic_libs('espeakng_loader')
# soundfile: bundled libsndfile native library
_soundfile_data = collect_data_files('_soundfile_data')
_soundfile_libs = collect_dynamic_libs('_soundfile_data')
# kokoro-onnx: config.json (vocab) must be collected
_kokoro_data = collect_data_files('kokoro_onnx')


a = Analysis(
    ['run.py'],
    pathex=[],
    binaries=_espeakng_libs + _soundfile_libs,
    datas=[('app', 'app'), ('scraper-service/app', 'scraper-service/app')] + _espeakng_data + _soundfile_data + _kokoro_data,
    hiddenimports=['uvicorn', 'uvicorn.logging', 'uvicorn.loops', 'uvicorn.loops.auto', 'uvicorn.protocols', 'uvicorn.protocols.http', 'uvicorn.protocols.http.auto', 'uvicorn.protocols.websockets', 'uvicorn.protocols.websockets.auto', 'uvicorn.lifespan', 'uvicorn.lifespan.on', 'httptools', 'pydantic', 'fastapi', 'websockets', 'httpx', 'curl_cffi', 'bs4', 'lxml', 'selectolax', 'asyncpg', 'cachetools', 'tldextract', 'markdownify', 'tabulate', 'fitz', 'pytesseract', 'kokoro_onnx', 'kokoro_onnx.tokenizer', 'kokoro_onnx.config', 'kokoro_onnx.trim', 'phonemizer', 'phonemizer.backend', 'phonemizer.backend.espeak', 'phonemizer.backend.espeak.wrapper', 'espeakng_loader', '_soundfile_data', 'app.tools.tools.system', 'app.tools.tools.file_ops', 'app.tools.tools.clipboard', 'app.tools.tools.execution', 'app.tools.tools.network', 'app.tools.tools.notify', 'app.tools.tools.transfer', 'app.tools.tools.process_manager', 'app.tools.tools.window_manager', 'app.tools.tools.input_automation', 'app.tools.tools.audio', 'app.tools.tools.browser_automation', 'app.tools.tools.network_discovery', 'app.tools.tools.system_monitor', 'app.tools.tools.file_watch', 'app.tools.tools.app_integration', 'app.tools.tools.scheduler', 'app.tools.tools.media', 'app.tools.tools.wifi_bluetooth', 'pydantic_settings', 'psutil', 'zeroconf', 'watchfiles', 'sounddevice', 'soundfile', 'pynput', 'playwright', 'playwright.async_api'],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['torch', 'torchvision', 'torchaudio', 'tensorflow', 'tensorboard', 'triton', 'scipy', 'nipype', 'nibabel', 'pyxnat', 'openai_whisper', 'whisper', 'matplotlib', 'sklearn', 'skimage', 'cv2', 'IPython', 'ipykernel', 'jupyter', 'ipywidgets'],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='aimatrx-engine-x86_64-unknown-linux-gnu',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
