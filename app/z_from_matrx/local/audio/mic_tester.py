import speech_recognition as sr
import sounddevice as sd
import numpy as np
import wave
import os


def list_input_devices():
    print("\nAvailable input devices:")
    mic_list = []
    for index, name in enumerate(sr.Microphone.list_microphone_names()):
        if "microphone" in name.lower() or "input" in name.lower():
            mic_list.append((index, name))
            print(f"{index}: {name}")
    return mic_list


def record_and_playback(mic_index):
    recognizer = sr.Recognizer()
    with sr.Microphone(device_index=mic_index) as source:
        recognizer.adjust_for_ambient_noise(source, duration=1)
        print("Recording a short sample (say something)...")
        try:
            audio = recognizer.listen(source, timeout=5, phrase_time_limit=5)
        except sr.WaitTimeoutError:
            print("No speech detected. Please try again.")
            return False

    wav_file = "test_audio.wav"
    with wave.open(wav_file, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(44100)
        wf.writeframes(audio.get_raw_data())

    print("Playing back the recorded audio...")
    wf = wave.open(wav_file, "rb")
    frames = wf.readframes(wf.getnframes())
    samples = np.frombuffer(frames, dtype=np.int16)
    if wf.getnchannels() > 1:
        samples = samples.reshape(-1, wf.getnchannels())
    sd.play(samples, samplerate=wf.getframerate())
    sd.wait()
    wf.close()
    os.remove(wav_file)

    return True


def select_and_test_microphone():
    while True:
        mic_list = list_input_devices()
        if not mic_list:
            print("No input devices found.")
            return None

        while True:
            try:
                mic_index = int(input("Select the microphone index: "))
                if any(mic_index == mic[0] for mic in mic_list):
                    break
                else:
                    print("Selected index not in the list. Please try again.")
            except ValueError:
                print("Invalid input. Please enter a number.")

        if record_and_playback(mic_index):
            choice = input("Did you hear your recording? (yes/no): ").lower()
            if choice == "yes":
                use_mic = input("Do you want to use this microphone? (yes/no): ").lower()
                if use_mic == "yes":
                    selected_mic = next(mic for mic in mic_list if mic[0] == mic_index)
                    return {
                        "index": selected_mic[0],
                        "name": selected_mic[1],
                        "sample_rate": sr.Microphone(device_index=mic_index).SAMPLE_RATE,
                        "chunk_size": sr.Microphone(device_index=mic_index).CHUNK,
                        "channels": 1,  # Assuming mono channel
                    }

        retry = input("Do you want to test another microphone? (yes/no): ").lower()
        if retry != "yes":
            return None


if __name__ == "__main__":
    selected_microphone = select_and_test_microphone()
    if selected_microphone:
        print("\nSelected Microphone Details:")
        for key, value in selected_microphone.items():
            print(f"{key}: {value}")
    else:
        print("No microphone selected.")
