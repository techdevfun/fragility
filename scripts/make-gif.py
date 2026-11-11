#!/usr/bin/env python3
"""Render demo/transcript.txt as a terminal-typing GIF (PIL, DejaVuSansMono).
The transcript is generated from real CLI runs (scripts/capture-demo.sh);
this script only renders it, never edits the content."""
from PIL import Image, ImageDraw, ImageFont
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

W = 1240
BG = (18, 18, 24)
FG = (220, 220, 220)
DIM = (150, 150, 160)
GREEN = (120, 220, 130)
YELLOW = (235, 200, 100)
RED = (240, 110, 110)
CYAN = (120, 200, 230)

font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf", 12)
bold = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf", 12)
LINE_H = 16

lines = open(os.path.join(ROOT, "demo", "transcript.txt")).read().splitlines()
H = 14 + len(lines) * LINE_H + 44

def color_for(line: str):
    if line.startswith("$"):
        return GREEN
    if line.startswith("#"):
        return DIM
    if "FRAGILE" in line or "WEAK" in line:
        return RED
    if "ROBUST" in line:
        return GREEN
    if "WATCH" in line or "SKIPPED" in line:
        return YELLOW
    if line.startswith("exit: 1"):
        return RED
    if line.startswith("exit: 0"):
        return GREEN
    if "orphan" in line:
        return YELLOW
    return FG

frames = []
canvas: list[tuple[str, tuple]] = []

# Title card (3s): what the demo shows
title = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(title)
d.text((14, 200), "fragility - how fragile is the AI-written diff?", font=bold, fill=GREEN)
d.text((14, 250), "1. explain: the four fragility modes and how they are measured", font=font, fill=FG)
d.text((14, 280), "2. audit a 1,199-line AI-style change: FRAGILE, exit 1", font=font, fill=FG)
d.text((14, 310), "3. audit a 19-line healthy change: ROBUST, exit 0", font=font, fill=FG)
d.text((14, 380), "zero-dep CLI - offline, no API key, no server", font=font, fill=DIM)
d.text((14, 410), "synthetic seeded fixture repo (seed 20261111), real CLI output", font=font, fill=DIM)
for _ in range(50):
    frames.append(title.copy())

def render(canvas_tmp):
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    y = 14
    for text, color in canvas_tmp:
        f = bold if text.startswith("$") else font
        d.text((14, y), text, font=f, fill=color)
        y += LINE_H
        if y > H - 30:
            break
    d.rectangle([14, H - 24, 22, H - 12], fill=GREEN)
    return img

for line in lines:
    color = color_for(line)
    step = max(1, len(line) // 10)
    for i in range(0, len(line) + 1, step):
        frames.append(render(canvas + [(line[:i], color)]))
    canvas.append((line, color))
    # Hold the completed line briefly so it reads before the next starts.
    frames.append(render(canvas))

out = os.path.join(ROOT, "demo", "fragility-demo.gif")
# 20 fps; title 50 frames = 2.5s; typing + holds bring the total to ~30s.
frames[0].save(out, save_all=True, append_images=frames[1:], duration=50, loop=0, optimize=True)
print(f"GIF written: {out} ({len(frames)} frames, {len(frames) * 50 / 1000:.1f}s)")
