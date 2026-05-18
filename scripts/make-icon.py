#!/usr/bin/env python3
"""Build the gitwink tray/app icon from a 2x2 design grid PNG.

Usage:
    python scripts/make-icon.py <path-to-grid.png>

Crops the top-right cell (option 2 — solid indigo disc), strips the outer
black canvas to transparent and the inner white glyph to transparent
(so the indigo brand color shows with a punched-out negative-space
glyph), then writes a 1024x1024 transparent PNG to
src-tauri/icons/icon-source.png. After that:

    pnpm tauri icon src-tauri/icons/icon-source.png

regenerates the full .ico / .icns / multi-size PNG set.
"""

import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    sys.exit("This script needs Pillow:  pip install Pillow")


BLACK_T = 25   # r,g,b all <= this  →  background black
WHITE_T = 235  # r,g,b all >= this  →  glyph white


def main():
    if len(sys.argv) < 2:
        sys.exit("Usage: make-icon.py <path-to-grid.png>")

    grid_path = Path(sys.argv[1]).expanduser().resolve()
    if not grid_path.exists():
        sys.exit(f"Not found: {grid_path}")

    img = Image.open(grid_path).convert("RGBA")
    w, h = img.size
    print(f"Source: {w}x{h}  ({grid_path})")

    # Top-right cell: x = w/2 .. w,  y = 0 .. h/2
    cell = img.crop((w // 2, 0, w, h // 2))
    cw, ch = cell.size
    print(f"Cropped TR cell: {cw}x{ch}")

    px = cell.load()
    cleared = 0
    for y in range(ch):
        for x in range(cw):
            r, g, b, _ = px[x, y]
            if (r <= BLACK_T and g <= BLACK_T and b <= BLACK_T) or (
                r >= WHITE_T and g >= WHITE_T and b >= WHITE_T
            ):
                px[x, y] = (0, 0, 0, 0)
                cleared += 1
    print(f"Cleared {cleared} px to transparent")

    out = cell.resize((1024, 1024), Image.LANCZOS)

    out_dir = Path(__file__).parent.parent / "src-tauri" / "icons"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "icon-source.png"
    out.save(out_path)
    print(f"Wrote {out_path}")
    print("\nNext:  pnpm tauri icon src-tauri/icons/icon-source.png")


if __name__ == "__main__":
    main()
