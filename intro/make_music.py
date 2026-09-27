"""Generate an original 27-second electronic underscore for the Rover film."""

from pathlib import Path
import wave

import numpy as np

RATE = 48_000
DURATION = 27.0
N = int(RATE * DURATION)
left = np.zeros(N, dtype=np.float64)
right = np.zeros(N, dtype=np.float64)
rng = np.random.default_rng(10528)


def put(start: float, sound: np.ndarray, gain: float = 1, pan: float = 0) -> None:
    i = max(0, int(start * RATE))
    j = min(N, i + len(sound))
    if j <= i:
        return
    part = sound[: j - i] * gain
    left[i:j] += part * np.sqrt((1 - pan) / 2)
    right[i:j] += part * np.sqrt((1 + pan) / 2)


def osc(freq: float, seconds: float, harmonics=(1.0,)) -> np.ndarray:
    t = np.arange(int(seconds * RATE)) / RATE
    return sum(a * np.sin(2 * np.pi * freq * (n + 1) * t) for n, a in enumerate(harmonics))


def pluck(freq: float, seconds=0.72) -> np.ndarray:
    t = np.arange(int(seconds * RATE)) / RATE
    env = (1 - np.exp(-t * 95)) * np.exp(-t * 5.4)
    shimmer = 0.22 * np.sin(2 * np.pi * freq * 2.004 * t)
    return (osc(freq, seconds, (1, 0.38, 0.13)) + shimmer) * env


def pad(freq: float, seconds: float) -> np.ndarray:
    t = np.arange(int(seconds * RATE)) / RATE
    env = np.minimum(1, t / 0.6) * np.minimum(1, (seconds - t) / 0.7)
    vibrato = 1 + 0.002 * np.sin(2 * np.pi * 0.45 * t)
    return (np.sin(2 * np.pi * freq * t * vibrato) + 0.35 * np.sin(2 * np.pi * freq * 2.01 * t)) * env


def kick() -> np.ndarray:
    seconds = 0.42
    t = np.arange(int(seconds * RATE)) / RATE
    phase = 2 * np.pi * (51 * t + 85 * (1 - np.exp(-t * 34)) / 34)
    return np.sin(phase) * np.exp(-t * 14) + 0.09 * rng.normal(size=len(t)) * np.exp(-t * 88)


def snare() -> np.ndarray:
    t = np.arange(int(0.24 * RATE)) / RATE
    noise = rng.normal(size=len(t))
    return (noise * 0.64 + np.sin(2 * np.pi * 185 * t) * 0.36) * np.exp(-t * 22)


def hat(open_hat=False) -> np.ndarray:
    seconds = 0.24 if open_hat else 0.085
    t = np.arange(int(seconds * RATE)) / RATE
    noise = rng.normal(size=len(t))
    # High-pass by subtracting a short moving average.
    smooth = np.convolve(noise, np.ones(16) / 16, mode="same")
    return (noise - smooth) * np.exp(-t * (23 if open_hat else 77))


# Four-bar harmonic bed, slightly wider in the second half.
chords = [
    (110.00, 130.81, 164.81),  # A minor
    (87.31, 110.00, 130.81),   # F major
    (130.81, 164.81, 196.00),  # C major
    (98.00, 123.47, 146.83),   # G major
]
for bar in range(14):
    start = bar * 2.0
    chord = chords[bar % 4]
    for note_index, frequency in enumerate(chord):
        p = pad(frequency, 2.15)
        put(start, p, 0.055 if start < 4 else 0.075, [-0.65, 0, 0.65][note_index])
    if start >= 4:
        bass = osc(chord[0] / 2, 1.7, (1, 0.24))
        tt = np.arange(len(bass)) / RATE
        put(start, bass * np.exp(-tt * 2.3), 0.19)


# Musical pulse grows as Rover takes control of the workflow.
for beat in range(54):
    t = beat * 0.5
    if t >= 4:
        put(t, kick(), 0.28 if t < 8 else 0.40)
    if t >= 8 and beat % 4 == 2:
        put(t, snare(), 0.10, 0.12)
    if t >= 8:
        put(t + 0.25, hat(), 0.07, 0.46 if beat % 2 else -0.46)
    if t >= 13 and beat % 4 == 3:
        put(t + 0.25, hat(True), 0.075, 0.2)

melody = [440, 523.25, 659.25, 523.25, 392, 523.25, 659.25, 783.99,
          523.25, 659.25, 783.99, 659.25, 493.88, 587.33, 783.99, 987.77]
for index, t in enumerate(np.arange(4.5, 26.5, 0.5)):
    frequency = melody[index % len(melody)]
    put(float(t), pluck(frequency), 0.08 if t < 8 else 0.12, -0.5 if index % 2 else 0.5)
    if t >= 18 and index % 4 == 0:
        put(float(t), pluck(frequency / 2, 1.0), 0.08, 0)


# Scene changes: a soft reverse-noise swell followed by an electronic chime.
for cue in (4.5, 8.0, 13.0, 18.0, 22.5):
    t = np.arange(int(0.55 * RATE)) / RATE
    noise = rng.normal(size=len(t))
    rise = (t / 0.55) ** 1.8
    put(cue - 0.55, noise * rise, 0.018, -0.25)
    put(cue, pluck(880 if cue != 22.5 else 1046.5, 1.5), 0.095, 0.32)


# Brand ending: clean three-note cadence with a low final root.
for t, frequency, pan in ((23.0, 523.25, -0.35), (23.5, 659.25, 0.35), (24.0, 880, 0), (25.0, 220, 0)):
    put(t, pluck(frequency, 1.7), 0.16, pan)

fade_in = np.minimum(1, np.arange(N) / (RATE * 0.5))
fade_out = np.minimum(1, (N - np.arange(N)) / (RATE * 1.2))
mix = np.stack([left, right], axis=1) * np.minimum(fade_in, fade_out)[:, None]
mix = np.tanh(mix * 1.45)
mix *= 0.82 / max(np.max(np.abs(mix)), 1e-6)

target = Path(__file__).parent / "public" / "music.wav"
target.parent.mkdir(exist_ok=True)
with wave.open(str(target), "wb") as wav:
    wav.setnchannels(2)
    wav.setsampwidth(2)
    wav.setframerate(RATE)
    wav.writeframes((mix * 32767).astype("<i2").tobytes())
print(target)
