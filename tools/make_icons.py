#!/usr/bin/env python3
"""Generate the VibeJournal PWA icon set — Frosted Ink, strictly monochrome."""
import os
from PIL import Image, ImageDraw, ImageFilter

OUT = os.path.join(os.path.dirname(__file__), "..", "icons")
os.makedirs(OUT, exist_ok=True)

S = 1024          # master resolution
SS = 2            # supersample factor for the drawn art

INK        = (28, 28, 30)      # #1C1C1E
BG_BASE    = (11, 11, 13)      # dark surface
WHITE      = (255, 255, 255)
GREY_3     = (174, 174, 178)   # #AEAEB2
GREY_4     = (199, 199, 204)   # #C7C7CC


def master():
    """Art drawn on a transparent square; background added per-purpose."""
    n = S * SS
    art = Image.new("RGBA", (n, n), (0, 0, 0, 0))

    # --- decorative depth blob (grayscale only) ---
    blob = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    bd = ImageDraw.Draw(blob)
    bd.ellipse([n * 0.42, -n * 0.18, n * 1.28, n * 0.66], fill=(255, 255, 255, 96))
    blob = blob.filter(ImageFilter.GaussianBlur(n * 0.10))
    art = Image.alpha_composite(art, blob)

    # --- glass panel: translucent white + hairline stroke + soft shadow ---
    pad = n * 0.175
    radius = int(n * 0.155)
    shadow = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle(
        [pad, pad + n * 0.035, n - pad, n - pad + n * 0.035],
        radius=radius, fill=(0, 0, 0, 110),
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(n * 0.045))
    art = Image.alpha_composite(art, shadow)

    panel = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    ImageDraw.Draw(panel).rounded_rectangle(
        [pad, pad, n - pad, n - pad],
        radius=radius, fill=(255, 255, 255, 40),
        outline=(255, 255, 255, 150), width=max(1, int(n * 0.0065)),
    )
    art = Image.alpha_composite(art, panel)

    # --- equity curve: ascending polyline + soft area fill ---
    pts_n = [(0.275, 0.655), (0.415, 0.520), (0.545, 0.585), (0.700, 0.380), (0.760, 0.315)]
    pts = [(x * n, y * n) for x, y in pts_n]

    area = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    ImageDraw.Draw(area).polygon(
        [(p[0], p[1]) for p in pts] + [(pts[-1][0], n * 0.815), (pts[0][0], n * 0.815)],
        fill=(255, 255, 255, 30),
    )
    art = Image.alpha_composite(art, area)

    line = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    ld = ImageDraw.Draw(line)
    ld.line(pts, fill=(255, 255, 255, 255), width=int(n * 0.033), joint="curve")
    art = Image.alpha_composite(art, line)

    # --- node dots: last one is the "Ink"/solid accent marker ---
    for i, (x, y) in enumerate(pts):
        r = n * (0.036 if i == len(pts) - 1 else 0.021)
        col = WHITE if i == len(pts) - 1 else (255, 255, 255, 205)
        if i == len(pts) - 1:
            halo = Image.new("RGBA", (n, n), (0, 0, 0, 0))
            ImageDraw.Draw(halo).ellipse(
                [x - r * 2.5, y - r * 2.5, x + r * 2.5, y + r * 2.5],
                fill=(255, 255, 255, 40),
            )
            art = Image.alpha_composite(art, halo.filter(ImageFilter.GaussianBlur(n * 0.02)))
        ld = ImageDraw.Draw(art)
        ld.ellipse([x - r, y - r, x + r, y + r], fill=col)

    return art.resize((S, S), Image.LANCZOS)


def compose(size, art, bg, radius_ratio, bleed=False):
    """Flat-background composition. bleed=True -> full-bleed square (maskable)."""
    if bleed:
        canvas = Image.new("RGBA", (size, size), bg + (255,))
        canvas = Image.alpha_composite(canvas, art.resize((size, size), Image.LANCZOS))
        return canvas.convert("RGB")

    pad = int(size * 0.035)
    rr = int(size * radius_ratio)

    # 1. flat base
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(canvas).rounded_rectangle(
        [pad, pad, size - pad, size - pad], radius=rr, fill=bg + (255,),
    )

    # 2. art, clipped to the same rounded rect
    inner = art.resize((size, size), Image.LANCZOS)
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [pad, pad, size - pad, size - pad], radius=rr, fill=255,
    )

    # 3. composite art ON TOP of base (alpha-over, not replace)
    art_layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    art_layer.paste(inner, (0, 0), mask)
    return Image.alpha_composite(canvas, art_layer)


def main():
    art = master()

    targets = [
        ("icon-192.png",            192, BG_BASE, 0.225, False),
        ("icon-512.png",            512, BG_BASE, 0.225, False),
        ("icon-maskable-512.png",   512, BG_BASE, 0.0,   True),
        ("apple-touch-icon.png",    180, BG_BASE, 0.0,   True),
        ("favicon-32.png",           32, BG_BASE, 0.225, False),
    ]
    for name, size, bg, rr, bleed in targets:
        img = compose(size, art, bg, rr, bleed)
        path = os.path.abspath(os.path.join(OUT, name))
        img.save(path, "PNG", optimize=True)
        print(f"  {name:24s} {size}x{size}  {os.path.getsize(path)/1024:6.1f} KB")


if __name__ == "__main__":
    main()
