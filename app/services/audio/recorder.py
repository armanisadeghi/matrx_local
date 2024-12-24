import sounddevice as sd
import numpy as np

def record_audio(duration: int = 5, samplerate: int = 44100):
    print("Recording...")
    audio = sd.rec(int(duration * samplerate), samplerate=samplerate, channels=2, dtype=np.int16)
    sd.wait()
    return audio
