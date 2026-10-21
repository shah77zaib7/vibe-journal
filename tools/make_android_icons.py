#!/usr/bin/env python3
"""Generate Android adaptive icons + splash for VibeJournal.

Android adaptive icons are two layers: a background (fills the square) and a
foreground (the logo, which must survive being cropped to any shape and
sitting inside a 66% safe zone). The web icons in icons/ are square, so they
are rebuilt here as proper layers.
"""
import os
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
RES = os.path.join(HERE, "..", "android", "app", "src", "main", "res")
INK = (11, 11, 13)
SURFACE = (21, 21, 26)
WHITE = (245, 245, 247)

# adaptive icon layers are 108dp; the 72dp centre is the guaranteed-visible area
S = 1080
FG_SCALE = 0.42          # logo occupies ~42% of the full canvas → sits in the safe zone
BG_SCALE = 0.62


def hex_to_png(name, size, draw_fn, bg=None):
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    draw_fn(d)
    if bg is not None:
        flat = Image.new("RGBA", (S, S), bg + (255,))
        flat = Image.alpha_composite(flat, img)
        img = flat
    out = img.resize((size, size), Image.LANCZOS)
    path = os.path.join(RES, name)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    out.save(path, "PNG", optimize=True)
    return path


def draw_logo(d, scale, colour=WHITE, glow=True):
    """The ascending equity curve + glass tile, as a standalone layer."""
    w = S * scale
    ox = (S - w) / 2
    oy = (S - w) / 2

    # glass tile
    pad = w * 0.04
    r = w * 0.22
    d.rounded_rectangle(
        [ox + pad, oy + pad, ox + w - pad, oy + w - pad],
        radius=r, fill=(255, 255, 255, 26), outline=(255, 255, 255, 90),
        width=max(1, int(w * 0.012)),
    )

    # ascending candles
    n = 7
    top = oy + w * 0.20
    bot = oy + w * 0.80
    step = (bot - top) / (n - 1)
    bw = w * 0.075
    heights = [0.22, 0.30, 0.26, 0.38, 0.34, 0.44, 0.52]
    for i in range(n):
        cx = ox + w * 0.20 + i * (w * 0.60 / (n - 1))
        h = (bot - top) * heights[i] * 1.5
        y0 = bot - h
        d.rounded_rectangle(
            [cx - bw / 2, y0, cx + bw / 2, bot],
            radius=bw * 0.35, fill=colour + (235,),
        )
        # wick
        d.line([(cx, y0 - step * 0.22), (cx, bot + step * 0.06)],
               fill=colour + (120,), width=max(1, int(w * 0.008)))
    return (ox, oy, w)


def main():
    made = []

    # ---- background layer: flat ink with a soft top-right glow ----
    def bg_fn(d):
        d.ellipse([S * 0.35, -S * 0.30, S * 1.45, S * 0.80],
                  fill=(255, 255, 255, 16))
        d.ellipse([-S * 0.30, S * 0.45, S * 0.75, S * 1.50],
                  fill=(255, 255, 255, 10))

    bg = Image.new("RGBA", (S, S), INK + (255,))
    bgl = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(bgl).ellipse([S * 0.35, -S * 0.30, S * 1.45, S * 0.80], fill=(255, 255, 255, 18))
    bgl = bgl.filter(ImageFilter.GaussianBlur(S * 0.06))
    bg = Image.alpha_composite(bg, bgl)
    for d in ["hdpi", "mdpi", "xhdpi", "xxhdpi", "xxxhdpi"]:
        px = {"mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}[d]
        p = os.path.join(RES, "mipmap-" + d, "ic_launcher_background.png")
        os.makedirs(os.path.dirname(p), exist_ok=True)
        bg.resize((px, px), Image.LANCZOS).save(p, "PNG", optimize=True)
        made.append(p)

    # ---- foreground layer: the logo, sized for the safe zone ----
    fg = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    fd = ImageDraw.Draw(fg)
    # faint glass tile behind the candles
    draw_logo(fd, FG_SCALE, WHITE)
    for d in ["mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"]:
        px = {"mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}[d]
        p = os.path.join(RES, "mipmap-" + d, "ic_launcher_foreground.png")
        os.makedirs(os.path.dirname(p), exist_ok=True)
        fg.resize((px, px), Image.LANCZOS).save(p, "PNG", optimize=True)
        made.append(p)

    # ---- legacy square/round icons (pre-API 26) ----
    legacy = Image.new("RGBA", (S, S), INK + (255,))
    legacy = Image.alpha_composite(legacy, fg)
    for d in ["mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"]:
        px = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}[d]
        p = os.path.join(RES, "mipmap-" + d, "ic_launcher.png")
        legacy.resize((px, px), Image.LANCZOS).save(p, "PNG", optimize=True)
        made.append(p)
        p = os.path.join(RES, "mipmap-" + d, "ic_launcher_round.png")
        legacy.resize((px, px), Image.LANCZOS).save(p, "PNG", optimize=True)
        made.append(p)

    # ---- adaptive icon xml ----
    anydpi = os.path.join(RES, "mipmap-anydpi-v26")
    os.makedirs(anydpi, exist_ok=True)
    for name in ["ic_launcher.xml", "ic_launcher_round.xml"]:
        with open(os.path.join(anydpi, name), "w") as f:
            f.write("""<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
    <monochrome android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
""")
        made.append(os.path.join(anydpi, name))

    # ---- splash ----
    # NOTE: the logo PNG and the layer-list must NOT share a name, or AAPT
    # reports "Duplicate resources".
    draw = os.path.join(RES, "drawable")
    os.makedirs(draw, exist_ok=True)

    logo = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    draw_logo(ImageDraw.Draw(logo), 0.5, WHITE)
    logo.resize((1080, 1080), Image.LANCZOS).save(
        os.path.join(draw, "splash_logo.png"), "PNG", optimize=True)
    made.append(os.path.join(draw, "splash_logo.png"))

    with open(os.path.join(draw, "splash.xml"), "w") as f:
        f.write("""<?xml version="1.0" encoding="utf-8"?>
<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <item android:drawable="@color/vibeInk"/>
    <item>
        <bitmap android:gravity="center" android:src="@drawable/splash_logo"/>
    </item>
</layer-list>
""")
    made.append(os.path.join(draw, "splash.xml"))

    for p in made:
        print("  ", os.path.relpath(p, RES))
    print(f"✓ {len(made)} android icon/splash resources written")


if __name__ == "__main__":
    main()
