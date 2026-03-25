# Wake Word — Training “Hey Matrix” (openWakeWord)

> **Operators / Arman** — End users ship with a default model; this doc is for training or retraining `hey_matrix.onnx` to bundle in releases.

## One-time environment

```bash
python3.13 -m venv ~/wakeword-train
source ~/wakeword-train/bin/activate
pip install "openwakeword[train]"
```

## Step 1 — Synthetic positives

```bash
python -m openwakeword.train generate_samples \
  --phrase "hey matrix" \
  --n_samples 5000 \
  --output_dir ~/wakeword-training/positive
```

(~10–20 min CPU.)

## Step 2 — Negative / background data (once per machine)

```bash
python -m openwakeword.train download_background_data \
  --output_dir ~/wakeword-training/negative
```

(~2 GB.)

## Step 3 — Train

```bash
python -m openwakeword.train train \
  --positive_dir ~/wakeword-training/positive \
  --negative_dir ~/wakeword-training/negative \
  --model_name hey_matrix \
  --output_dir ~/.matrx/oww_models/
```

Produces `hey_matrix.onnx` (~3 MB).

## Step 4 — Evaluate

```bash
python -m openwakeword.train evaluate \
  --model_path ~/.matrx/oww_models/hey_matrix.onnx \
  --test_dir ~/my_test_recordings/
```

Thresholds: `0.3–0.4` sensitive; `0.5` balanced; `0.7–0.8` strict.

## Step 5 — Bundle

- Test: copy to `~/.matrx/oww_models/` and pick it in **Voice → Wake Word → OWW Models**.
- Ship: add `desktop/src-tauri/resources/oww_models/hey_matrix.onnx` and `resources/oww_models/**` in `tauri.conf.json`; ensure `app/services/wake_word/models.py` checks bundled path before `~/.matrx/oww_models/`.
