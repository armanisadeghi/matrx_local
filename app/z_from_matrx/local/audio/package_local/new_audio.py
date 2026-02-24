import io
import os
from pydub import AudioSegment


class AudioData:
    def __init__(self, frame_data, sample_rate, sample_width):
        assert sample_rate > 0, "Sample rate must be a positive integer"
        assert 1 <= sample_width <= 4, "Sample width must be between 1 and 4 inclusive"
        self.frame_data = frame_data
        self.sample_rate = sample_rate
        self.sample_width = int(sample_width)

    def get_segment(self, start_ms=None, end_ms=None):
        audio = AudioSegment(
            data=self.frame_data,
            sample_width=self.sample_width,
            frame_rate=self.sample_rate,
            channels=1,
        )
        if start_ms is not None:
            audio = audio[start_ms:]
        if end_ms is not None:
            audio = audio[: end_ms - (start_ms or 0)]
        return AudioData(audio.raw_data, audio.frame_rate, audio.sample_width)

    def get_raw_data(self, convert_rate=None, convert_width=None):
        audio = AudioSegment(
            data=self.frame_data,
            sample_width=self.sample_width,
            frame_rate=self.sample_rate,
            channels=1,
        )
        if convert_rate:
            audio = audio.set_frame_rate(convert_rate)
        if convert_width:
            audio = audio.set_sample_width(convert_width)
        return audio.raw_data

    def get_wav_data(self, convert_rate=None, convert_width=None):
        audio = AudioSegment(
            data=self.frame_data,
            sample_width=self.sample_width,
            frame_rate=self.sample_rate,
            channels=1,
        )
        if convert_rate:
            audio = audio.set_frame_rate(convert_rate)
        if convert_width:
            audio = audio.set_sample_width(convert_width)
        buffer = io.BytesIO()
        audio.export(buffer, format="wav")
        return buffer.getvalue()

    def get_aiff_data(self, convert_rate=None, convert_width=None):
        audio = AudioSegment(
            data=self.frame_data,
            sample_width=self.sample_width,
            frame_rate=self.sample_rate,
            channels=1,
        )
        if convert_rate:
            audio = audio.set_frame_rate(convert_rate)
        if convert_width:
            audio = audio.set_sample_width(convert_width)
        buffer = io.BytesIO()
        audio.export(buffer, format="aiff")
        return buffer.getvalue()

    def get_flac_data(self, convert_rate=None, convert_width=None):
        audio = AudioSegment(
            data=self.frame_data,
            sample_width=self.sample_width,
            frame_rate=self.sample_rate,
            channels=1,
        )
        if convert_rate:
            audio = audio.set_frame_rate(convert_rate)
        if convert_width:
            audio = audio.set_sample_width(min(convert_width, 3))  # FLAC supports up to 24-bit
        buffer = io.BytesIO()
        audio.export(buffer, format="flac")
        return buffer.getvalue()


def get_flac_converter():
    flac_converter = shutil_which("flac")
    if flac_converter is None:
        raise OSError("FLAC conversion utility not available. Please install FLAC command line application.")
    return flac_converter


def shutil_which(pgm):
    path = os.getenv("PATH")
    for p in path.split(os.path.pathsep):
        p = os.path.join(p, pgm)
        if os.path.exists(p) and os.access(p, os.X_OK):
            return p
