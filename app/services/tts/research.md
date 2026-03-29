**The best places to find or create additional female English voices for Kokoro TTS (beyond the official ~20 American + British ones like af_heart, af_bella, af_nicole, af_sky, bf_emma, bf_isabella, etc.) are community-driven blending tools and voice-cloning extensions.**

Kokoro (the 82M model from hexgrad/Kokoro-82M) doesn’t have a huge public library of pre-made “community voice packs” like some other TTS systems, because creating new voices is so easy and lightweight. Most users generate their own customs on the fly via **voice blending** (mixing official .pt/.bin embeddings) or **zero-shot cloning** from a short reference audio clip. These methods produce high-quality female voices with American, British, or hybrid accents.

### 1. Easiest Way: Blend Official Voices for New Female Variants (No Coding Needed)
You can mix any two (or more) official voices at different strengths to create unique female tones—e.g., a warmer American female, a more energetic British one, or a hybrid accent. This is the most common “custom” approach in the community.

- **Hugging Face Space (super simple web UI)**:  
  → [Make Custom Voices With KokoroTTS](https://huggingface.co/spaces/ysharma/Make_Custom_Voices_With_KokoroTTS)  
  Pick female voices from the official list, adjust sliders for each, and download the resulting .pt voice file instantly. Load it in your Kokoro setup. Perfect for quick American/British female experiments.

- **ComfyUI-Geeky-Kokoro-TTS** (most advanced local option):  
  Full support for all 54+ official voices + linear blending + **guided voice morphing** (use any audio clip as a target to steer the blend). Great if you already run ComfyUI.  
  Repo: [GeekyGhost/ComfyUI-Geeky-Kokoro-TTS](https://github.com/GeekyGhost/ComfyUI-Geeky-Kokoro-TTS)

Many YouTube tutorials (search “Kokoro TTS custom voices blending”) show the exact Python one-liner to blend locally if you prefer that.

### 2. True Custom Female Voices via Voice Cloning (From Any Reference Audio)
If you want voices that aren’t just mixes of the official ones, use a cloning layer on top of Kokoro.

- **KokoClone** (recommended – zero-shot, real-time, open-source):  
  Upload a short clean 3–10 second .wav of any female speaker (celebrity, your own voice, YouTube clip, etc.), type text, and it clones the timbre while keeping Kokoro’s excellent prosody. Supports English (American/British accents work great) and runs locally or via their HF demo.  
  → Live demo: [HF Space](https://huggingface.co/spaces/PatnaikAshish/kokoclone)  
  → GitHub: [Ashish-Patnaik/kokoclone](https://github.com/Ashish-Patnaik/kokoclone)

- Other local tools like KVoiceWalk or AI Voice Mixer Studio also let you generate or mix from reference audio and export .pt files.

### 3. Community Places Where People Share Custom Voices
- **Kokoro TTS Discord** (most active spot): https://discord.gg/QuGxSWBfQy  
  Users regularly post and trade custom .pt/.bin female voice files, blending recipes, and cloned packs. This is where you’ll most likely find ready-made ones others have created.

- **r/LocalLLaMA subreddit**: Search “Kokoro custom voices” or “Kokoro .pt” — threads discuss blending scripts and occasionally share Google Drive/Dropbox links to voice files.

- Hugging Face discussions on the main repo and various forks sometimes have shared voice tensors.

### Quick Tips for Your Setup
- Voice files are usually tiny `.pt` or `.bin` files (just 256-dim embeddings). Drop them in your `voices/` folder and reference them by filename in your Kokoro code/interface.
- Blending example (one-liner if you’re comfortable with Python):  
  ```python
  import torch
  bella = torch.load('voices/af_bella.pt')
  nicole = torch.load('voices/af_nicole.pt')
  custom_female = torch.mean(torch.stack([bella * 0.7, nicole * 0.3]), dim=0)
  torch.save(custom_female, 'voices/my_custom_af.pt')
  ```
- Most local Kokoro forks (PierrunoYT/Kokoro-TTS-Local, nazdridoy/kokoro-tts, etc.) already support loading any custom .pt/.bin automatically.

Start with the ysharma HF blending space or KokoClone demo — you’ll have new female voices in minutes. If you tell me what kind of tone/accent you’re after (e.g., warm narrator, energetic young American, calm British, etc.), I can suggest specific official voices to blend or cloning references!