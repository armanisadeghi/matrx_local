# DISABLED: faster_whisper (~130MB with CTranslate2). Not in use.
# To restore: uncomment WhisperModel import/init and wav_to_text body, add faster-whisper to pyproject.toml

from groq import Groq
from PIL import ImageGrab
from openai import OpenAI
# from faster_whisper import WhisperModel
import google.genai as genai
import speech_recognition as sr
import PIL.Image
import cv2
import pyperclip
import sounddevice as sd
import numpy as np
import os

os.environ["KMP_DUPLICATE_LIB_OK"] = "TRUE"

import time
import re
from dotenv import load_dotenv

load_dotenv()


os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = "google-credentials.json"


wake_word = "hey matrix"
groq_client = Groq(api_key=os.getenv("GROQ_API_KEY"))
openai_client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
genai.configure(api_key=os.getenv("GENAI_API_KEY"))
web_cam = cv2.VideoCapture(0)

sys_msg = (
    "You are a multi-modal AI voice assistant. Your user may or may not have attached a photo for context (either a screenshot or a webcam capture). "
    "Any photo has already been processed into a highly detailed text prompt that will be attached to their transcribed voice prompt. "
    "Generate the most useful and factual response possible, carefully considering all previous generated text in your response before "
    "adding new tokens to the response. Do not expect or request images, just use the context if added. Use all of the context of this "
    "conversation so your response is relevant to the conversation. Make your responses clear and concise, avoiding any verbosity."
)
convo = [{"role": "system", "content": sys_msg}]

# Gemini Flash configuration settings
generation_config = {
    "temperature": 0.7,
    "top_p": 1,
    "top_k": 1,
    "max_output_tokens": 2048,
}

# Remove Gemini safety filters
safety_settings = [
    {"category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_NONE"},
    {"category": "HARM_CATEGORY_HATE_SPEECH", "threshold": "BLOCK_NONE"},
    {"category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_NONE"},
    {"category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_NONE"},
]

model = genai.GenerativeModel(
    model_name="gemini-1.5-flash-latest",
    generation_config=generation_config,
    safety_settings=safety_settings,
)

num_cores = os.cpu_count()
print(f"Number of cores: {num_cores}")
# whisper_model = WhisperModel("base", device="cpu", compute_type="int8", ...)  # Disabled
whisper_model = None

r = sr.Recognizer()


def groq_prompt(prompt, img_context):
    if img_context:
        prompt = f"USER PROMPT: {prompt}\n\n    IMAGE CONTEXT: {img_context}"
    convo.append({"role": "user", "content": prompt})
    chat_completion = groq_client.chat.completions.create(messages=convo, model="llama3-70b-8192")
    response = chat_completion.choices[0].message
    convo.append(response)

    return response.content


def function_call(prompt):
    sys_msg = (
        "You are an AI function calling model. You will determine whether extracting the users clipboard content, taking a screenshot, capturing the "
        "webcam or calling no functions is best for a voice assistant to respond to the users prompt. The webcam can be assumed to be a normal laptop webcam "
        'facing the user. You will respond with only one selection from this list: ["extract clipboard", "take screenshot", "capture webcam", "None"] \n'
        "Do not respond with anything but the most logical selection from that list with no explanations. Format the function call name exactly as I listed."
    )

    function_convo = [
        {"role": "system", "content": sys_msg},
        {"role": "user", "content": prompt},
    ]

    chat_completion = groq_client.chat.completions.create(messages=function_convo, model="llama3-70b-8192")
    response = chat_completion.choices[0].message

    return response.content


def vision_prompt(prompt, photo_path):
    img = PIL.Image.open(photo_path)
    prompt = (
        "You are the vision analysis AI that provides semtantic meaning from images to provide context to send to another AI that will create a response to the user. "
        "Do not respond as the AI assistant to the user. Instead take the user prompt input and try to extract all meaning from the photo relevant to the user prompt. "
        f"Then generate as much objective data about the image for the AI assistant who will respond to the user. \nUSER PROMPT: {prompt}"
    )
    response = model.generate_content([prompt, img])
    return response.text


def take_screenshot():
    path = "screenshot.jpg"
    screenshot = ImageGrab.grab()
    rgb_screenshot = screenshot.convert("RGB")
    rgb_screenshot.save(path, quality=15)


def web_cam_capture():
    if not web_cam.isOpened():
        print("Error: Unable to open camera")
        exit()
    path = "webcam.jpg"
    ret, frame = web_cam.read()
    cv2.imwrite(path, frame)


def get_clipboard_text():
    try:
        # Try to get text from the clipboard
        clipboard_content = pyperclip.paste()
        # Check if the clipboard content is indeed a string
        if isinstance(clipboard_content, str):
            return clipboard_content
        else:
            print("Clipboard content is not text.")
            return None
    except Exception as e:
        # Handle unexpected exceptions
        print(f"An error occurred: {e}")
        return None


def speak(text):
    sample_rate = 24000
    audio_chunks = []

    with openai_client.audio.speech.with_streaming_response.create(
        model="tts-1",
        voice="alloy",
        response_format="pcm",
        input=text,
    ) as response:
        silence_threshold = 0.01
        stream_start = False
        for chunk in response.iter_bytes(chunk_size=1024):
            if stream_start:
                audio_chunks.append(chunk)
            else:
                if max(chunk) > silence_threshold:
                    audio_chunks.append(chunk)
                    stream_start = True

    if audio_chunks:
        raw = b"".join(audio_chunks)
        samples = np.frombuffer(raw, dtype=np.int16)
        sd.play(samples, samplerate=sample_rate)
        sd.wait()


def wav_to_text(audio_path):
    if whisper_model is None:
        raise RuntimeError("faster_whisper is disabled. Add faster-whisper to pyproject.toml to restore.")
    segments, _ = whisper_model.transcribe(audio_path)
    text = "".join(segment.text for segment in segments)
    return text


def extract_prompt(transcribed_text, wake_word):
    pattern = rf"\b{re.escape(wake_word)}[\s,.?!]*([A-Za-z0-9].*)"
    match = re.search(pattern, transcribed_text, re.IGNORECASE)

    if match:
        prompt = match.group(1).strip()
        return prompt
    else:
        return None


def callback(recognizer, audio):
    prompt_audio_path = "prompt.wav"
    with open(prompt_audio_path, "wb") as f:
        f.write(audio.get_wav_data())

    # Transcribe the audio to text
    prompt_text = wav_to_text(prompt_audio_path)

    # Print the transcribed text for debugging purposes
    print(f"Transcribed: {prompt_text}")  # This line is added to output the transcription

    # Extract the specific part of the transcription that follows the wake word
    clean_prompt = extract_prompt(prompt_text, wake_word)

    if clean_prompt:
        print(f"USER: {clean_prompt}")
        call = function_call(clean_prompt)
        if "take screenshot" in call:
            print("Taking screenshot.")
            take_screenshot()
            visual_context = vision_prompt(prompt=clean_prompt, photo_path="screenshot.jpg")
        elif "capture webcam" in call:
            print("Capturing webcam.")
            web_cam_capture()
            visual_context = vision_prompt(prompt=clean_prompt, photo_path="webcam.jpg")
        elif "extract clipboard" in call:
            print("Extracting clipboard text.")
            paste = get_clipboard_text()
            clean_prompt = f"{clean_prompt} \n\n  CLIPBOARD CONTENT: {paste}"
            visual_context = None
        else:
            visual_context = None

        response = groq_prompt(prompt=clean_prompt, img_context=visual_context)
        print(f"ASSISTANT: {response}")
        speak(response)


def start_listening():
    # List all the microphone names and their respective index numbers
    print("Available microphones:")
    for index, name in enumerate(sr.Microphone.list_microphone_names()):
        print(f"{index}: {name}")

    # Let user select a microphone
    mic_index = int(input("Select the microphone index: "))
    source = sr.Microphone(device_index=mic_index)  # Use the selected microphone

    with source as s:
        r.adjust_for_ambient_noise(s, duration=2)
        print("\nSay", wake_word, "followed with your prompt. \n")
    r.listen_in_background(source, callback)

    while True:
        time.sleep(0.5)


if __name__ == "__main__":
    start_listening()
