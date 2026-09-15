#!/usr/bin/env python3
"""Generates the placeholder icon and posters for the Grapple Hook mod.

Textures are written as 8-bit palette PNGs, the only depth the game accepts.
Placeholders, not final art: replace them with real artwork when available.

    python3 GrappleHook/tools/make_assets.py
"""
import math
import struct
import zlib
from pathlib import Path

ITEM_ROOT = Path(__file__).resolve().parents[1]
MEDIA = ITEM_ROOT / "Contents/mods/GrappleHook/42/media"

TRANSPARENT, ROPE, STEEL, STEEL_DARK, BACKDROP = 0, 1, 2, 3, 4
PALETTE = [(0, 0, 0), (126, 96, 54), (198, 203, 209), (104, 110, 120), (16, 18, 22)]


def new_canvas(size, background=TRANSPARENT):
    return [[background] * size for _ in range(size)]


def put(canvas, x, y, colour):
    if 0 <= y < len(canvas) and 0 <= x < len(canvas[0]):
        canvas[y][x] = colour


def thick_line(canvas, x0, y0, x1, y1, colour, width=1):
    steps = int(max(abs(x1 - x0), abs(y1 - y0)) * 2) + 1
    for step in range(steps + 1):
        t = step / steps
        x = x0 + (x1 - x0) * t
        y = y0 + (y1 - y0) * t
        for dx in range(max(1, width)):
            for dy in range(max(1, width)):
                put(canvas, int(round(x)) + dx, int(round(y)) + dy, colour)


def draw_rope(canvas, centre_x, top, bottom, scale):
    for y in range(top, bottom):
        x = centre_x + int(round(math.sin((y - top) * 0.22) * 1.4 * scale))
        for thickness in range(max(2, scale // 2)):
            put(canvas, x + thickness, y, ROPE)


def draw_window(canvas, left, top, width, height):
    for x in range(left, left + width):
        put(canvas, x, top, STEEL_DARK)
        put(canvas, x, top + height, STEEL_DARK)
    for y in range(top, top + height):
        put(canvas, left, y, STEEL_DARK)
        put(canvas, left + width, y, STEEL_DARK)
    thick_line(canvas, left + width // 2, top, left + width // 2, top + height, STEEL_DARK, 2)


def draw_hook(canvas, centre_x, centre_y, scale):
    shaft_top = centre_y - 7 * scale
    shaft_bottom = centre_y + 2 * scale
    thick_line(canvas, centre_x, shaft_top, centre_x, shaft_bottom, STEEL, max(2, scale // 2))
    radius = 5 * scale
    for degree in range(0, 181, 2):
        radians = math.radians(degree)
        x = centre_x - radius * math.cos(radians)
        y = shaft_bottom + radius * math.sin(radians)
        for thickness in range(max(2, scale // 2)):
            put(canvas, int(round(x)), int(round(y)) + thickness, STEEL_DARK)
    # Barb at the open end of the hook.
    thick_line(canvas, centre_x - radius, shaft_bottom, centre_x - radius + scale, shaft_bottom - 3 * scale, STEEL, max(2, scale // 2))


def write_png(path, canvas, transparent=None):
    height, width = len(canvas), len(canvas[0])
    raw = b"".join(b"\x00" + bytes(row) for row in canvas)

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    parts = [b"\x89PNG\r\n\x1a\n",
             chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 3, 0, 0, 0)),
             chunk(b"PLTE", b"".join(bytes(colour) for colour in PALETTE))]
    if transparent is not None:
        parts.append(chunk(b"tRNS", bytes(0 if index == transparent else 255 for index in range(len(PALETTE)))))
    parts.append(chunk(b"IDAT", zlib.compress(raw, 9)))
    parts.append(chunk(b"IEND", b""))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"".join(parts))


def main():
    icon = new_canvas(32)
    draw_rope(icon, 16, 1, 11, 1)
    draw_hook(icon, 16, 17, 1)
    write_png(MEDIA / "textures/item_GrappleHook.png", icon, transparent=TRANSPARENT)

    poster = new_canvas(256, BACKDROP)
    draw_window(poster, 52, 26, 152, 104)
    draw_rope(poster, 128, 18, 92, 8)
    draw_hook(poster, 128, 152, 8)
    write_png(ITEM_ROOT / "Contents/mods/GrappleHook/42/poster.png", poster)
    write_png(ITEM_ROOT / "preview.png", poster)
    print("wrote item_GrappleHook.png, poster.png, preview.png")


if __name__ == "__main__":
    main()
