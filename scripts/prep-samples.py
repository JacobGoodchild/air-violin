#!/usr/bin/env python3
"""Turn the VSCO 2 Community Edition solo violin recordings (CC0) into small,
loopable mono WAV files plus a manifest the sound engine reads.

Usage: python3 scripts/prep-samples.py <folder with LLVln_ArcoVib_*.wav> assets/audio

Needs ffmpeg and numpy. Run once by hand; the output is committed, so the game
itself has no build step.
"""
import json, os, re, subprocess, sys
import numpy as np

SR = 32000
NOTE = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}


def load(path):
    raw = subprocess.run(['ffmpeg', '-v', 'quiet', '-i', path, '-ac', '1', '-ar', str(SR),
                          '-f', 'f32le', '-'], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).copy()


def pitch_hz(x):
    """Plain autocorrelation pitch estimate over a steady stretch."""
    seg = x[int(1.0 * SR):int(3.0 * SR)]
    seg = seg - seg.mean()
    n = len(seg)
    f = np.fft.rfft(seg, 2 * n)
    ac = np.fft.irfft(f * np.conj(f))[:n]
    lo, hi = int(SR / 2000), int(SR / 150)
    lag = lo + int(np.argmax(ac[lo:hi]))
    # parabolic interpolation
    a, b, c = ac[lag - 1], ac[lag], ac[lag + 1]
    lag = lag + 0.5 * (a - c) / (a - 2 * b + c)
    return SR / lag


def main(src, dst):
    os.makedirs(dst, exist_ok=True)
    out = []
    for name in sorted(os.listdir(src)):
        m = re.match(r'LLVln_ArcoVib_([A-G])(\d)_([pf])\.wav$', name)
        if not m:
            continue
        midi = 12 * (int(m.group(2)) + 1) + NOTE[m.group(1)]
        x = load(os.path.join(src, name))
        env = np.abs(x)
        thresh = env.max() * 0.02
        start = max(0, int(np.argmax(env > thresh)) - int(0.01 * SR))
        x = x[start:]
        hz = pitch_hz(x)
        cents = 1200 * np.log2(hz / (440 * 2 ** ((midi - 69) / 12)))
        if abs(cents) > 80:  # octave-off guess or bad estimate: trust the file name
            cents = 0.0
        # Loop: start at 1.4 s, end near 4.2 s where the waveform best matches the start.
        ls = int(1.4 * SR)
        w = int(0.03 * SR)
        ref = x[ls - w:ls + w]
        best, le = -1e9, int(4.2 * SR)
        for cand in range(int(3.9 * SR), int(4.5 * SR)):
            seg = x[cand - w:cand + w]
            score = float(np.dot(seg, ref)) / (np.linalg.norm(seg) * np.linalg.norm(ref) + 1e-9)
            if score > best:
                best, le = score, cand
        # Bake a crossfade so that jumping from le back to ls is seamless.
        xf = int(0.2 * SR)
        y = x[:le].copy()
        t = np.linspace(0, 1, xf)
        fade_in = np.sqrt(t)
        fade_out = np.sqrt(1 - t)
        y[le - xf:le] = x[le - xf:le] * fade_out + x[ls - xf:ls] * fade_in
        rms = float(np.sqrt(np.mean(y[ls:le] ** 2)))
        y = y / (rms * 8)  # same loudness for every file; the engine shapes dynamics
        peak = float(np.abs(y).max())
        if peak > 0.99:
            y = y * (0.99 / peak)
        fname = f'vln_{m.group(1)}{m.group(2)}_{m.group(3)}.wav'
        pcm = (np.clip(y, -1, 1) * 32767).astype('<i2').tobytes()
        subprocess.run(['ffmpeg', '-v', 'quiet', '-y', '-f', 's16le', '-ar', str(SR), '-ac', '1',
                        '-i', '-', os.path.join(dst, fname)], input=pcm, check=True)
        out.append({'file': fname, 'midi': midi, 'layer': m.group(3), 'cents': round(float(cents), 1),
                    'loopStart': round(ls / SR, 5), 'loopEnd': round(le / SR, 5),
                    'loopMatch': round(float(best), 3)})
        print(fname, midi, f'{cents:+.1f}c', f'loop {ls/SR:.3f}-{le/SR:.3f}', f'match {best:.3f}')
    with open(os.path.join(dst, 'manifest.json'), 'w') as f:
        json.dump({'sampleRate': SR, 'source': 'VSCO 2 Community Edition (CC0), Solo Violin Arco Vib',
                   'samples': out}, f, indent=1)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
