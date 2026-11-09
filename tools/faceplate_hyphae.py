#!/usr/bin/env python3
"""Looping hyphae for the Simple Touch faceplate, grown with the tip rules of ui/spore_boot.cpp.

    pip install pillow numpy
    python tools/faceplate_hyphae.py gif      [out.gif]   # default docs/faceplate_hyphae.gif
    python tools/faceplate_hyphae.py avif     [out.avif]  # default docs/faceplate_hyphae.avif
    python tools/faceplate_hyphae.py svg      [out.svg]   # default docs/faceplate_hyphae.svg (CSS animation, heavy to paint)
    python tools/faceplate_hyphae.py preview  [dir]       # four PNGs with the template's controls drawn in

Coordinates are artboard units (1080 x 1598.24), the raw numbers in docs/faceplate_empty.svg before
its group transform. Output covers the whole artboard, so it needs no placement in the designer.

Every point of the network stores the time a tip reached it. Its level is a function of
(t - birth) mod LOOP, so the last frame runs into the first with no cut.
"""
import math
import random
import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
TEMPLATE = ROOT / "docs" / "faceplate_empty.svg"

W, H = 1080, 1598
AMBER = np.array([217, 164, 65], float)
MATTE = np.array([20, 20, 20], float)      # plate colour: GIF has 1-bit alpha, so soft edges blend to this
AMBER_HEX = "#d9a441"

# Boot screen rules (ui/spore_boot.cpp)
TURN_PCT, BRANCH_PCT, MAX_TIPS = 25, 7, 48
DX = [1, 1, 0, -1, -1, -1, 0, 1]
DY = [0, 1, 1, 1, 0, -1, -1, -1]

STEP = 3.5            # artboard px per boot-screen pixel
SPEED = 13.0          # px/s of tip growth
LOOP = 24.0           # s
FPS = 8
HOLD = 11.0           # s before the fade starts
FADE = 8.0            # s from HOLD to nothing. HOLD + FADE must stay below LOOP
SEEDS = 34
LIFE = (80, 170)      # steps
MARGIN_CTL = 9        # px of clearance around controls
MARGIN_EDGE = 9       # px of clearance inside the plate outline
SEED_VALUE = 11       # change for a different network

GIF_LEVELS = 5        # amber shades. Fewer shades give a smaller file
SVG_CHUNK = 8         # steps per SVG path. Each path fades as one, so shorter chunks fade smoother and cost bytes

KNOBS = [(287.39, 611.53), (457.21, 611.53), (629.43, 611.53), (800.08, 611.53),
         (800.08, 800.66), (287.39, 800.66)]
KNOB_R = 32.03
JACKS = [(152.8, 283.76), (152.8, 454.81)]
JACK_R = 27.01
FADERS = [(152.295, 601.27, 878.18), (928.705, 601.27, 878.18)]  # x, top, bottom of the slot axis
FADER_R = 13.92


def outline():
    """The top plate polygon. The path in the template uses only L commands."""
    block = TEMPLATE.read_text().split('id="TEMPLATE_outline')[-1]
    d = re.findall(r'<path d="([^"]+)"', block)[0]
    nums = re.findall(r"-?\d+\.?\d*", d)
    return [(float(nums[i]), float(nums[i + 1])) for i in range(0, len(nums) - 1, 2)]


def build_mask(poly):
    im = Image.new("L", (W, H), 0)
    ImageDraw.Draw(im).polygon(poly, fill=255)
    for _ in range(MARGIN_EDGE):
        im = im.filter(ImageFilter.MinFilter(3))
    return np.asarray(im) > 0


def dist_controls(x, y):
    d = 1e9
    for cx, cy in KNOBS:
        d = min(d, math.hypot(x - cx, y - cy) - KNOB_R)
    for cx, cy in JACKS:
        d = min(d, math.hypot(x - cx, y - cy) - JACK_R)
    for cx, y0, y1 in FADERS:
        d = min(d, math.hypot(x - cx, y - min(max(y, y0), y1)) - FADER_R)
    return d


def near_control(x, y):
    """Distance to the nearest control edge and the outward unit vector there."""
    best = (1e9, 1.0, 0.0)
    pts = [(cx, cy, KNOB_R) for cx, cy in KNOBS] + [(cx, cy, JACK_R) for cx, cy in JACKS]
    pts += [(cx, min(max(y, y0), y1), FADER_R) for cx, y0, y1 in FADERS]
    for cx, cy, r in pts:
        h = math.hypot(x - cx, y - cy) or 1.0
        if h - r < best[0]:
            best = (h - r, (x - cx) / h, (y - cy) / h)
    return best


class Net:
    def __init__(self, poly):
        self.mask = build_mask(poly)
        self.poly = poly
        self.rng = random.Random(SEED_VALUE)
        self.segs = []        # x0, y0, x1, y1, birth0, birth1, tip id
        self.occ = {}
        self.next_uid = 0

    def uid(self):
        self.next_uid += 1
        return self.next_uid

    def clear(self, x, y):
        ix, iy = int(round(x)), int(round(y))
        if ix < 0 or iy < 0 or ix >= W or iy >= H or not self.mask[iy, ix]:
            return False
        return dist_controls(x, y) >= MARGIN_CTL

    def open_step(self, x, y, d):
        nx, ny = x + DX[d] * STEP, y + DY[d] * STEP
        return self.clear(nx, ny) and self.clear((x + nx) / 2, (y + ny) / 2)

    def seed_points(self):
        """Half spaced along the outline, half on the rims of the knobs and jacks."""
        rng = self.rng
        out = []
        p = self.poly
        lens = [math.dist(p[i], p[(i + 1) % len(p)]) for i in range(len(p))]
        total = sum(lens)
        n_edge = int(SEEDS * 0.5)
        for k in range(n_edge):
            s = (k + rng.random()) / n_edge * total
            i = 0
            while s > lens[i]:
                s -= lens[i]
                i += 1
            a, b = p[i], p[(i + 1) % len(p)]
            f = s / max(lens[i], 1e-6)
            x, y = a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f
            # The polygon runs clockwise on screen: inward is a quarter turn clockwise of the edge
            ang = math.atan2(b[1] - a[1], b[0] - a[0]) + math.pi / 2
            out.append((x + math.cos(ang) * (MARGIN_EDGE + 3), y + math.sin(ang) * (MARGIN_EDGE + 3), ang))
        rims = [(c[0], c[1], KNOB_R) for c in KNOBS] + [(c[0], c[1], JACK_R) for c in JACKS]
        for k in range(SEEDS - n_edge):
            cx, cy, r = rims[k % len(rims)]
            ang = rng.uniform(0, math.tau)
            rr = r + MARGIN_CTL + 3
            out.append((cx + math.cos(ang) * rr, cy + math.sin(ang) * rr, ang))
        rng.shuffle(out)
        return out

    def grow(self):
        rng = self.rng
        dt = STEP / SPEED
        seeds = self.seed_points()
        start = [(i + rng.random() * 0.8) / len(seeds) * LOOP for i in range(len(seeds))]
        tips = []
        nxt = 0
        t = 0.0
        while nxt < len(seeds) or tips:
            while nxt < len(seeds) and start[nxt] <= t:
                x, y, ang = seeds[nxt]
                if self.clear(x, y) and len(tips) < MAX_TIPS:
                    d = int(round(ang / (math.pi / 4))) & 7
                    d = (d + rng.choice((-1, 0, 1))) & 7
                    tips.append([x, y, d, rng.randint(*LIFE), rng.choice((1, -1)), 0, self.uid()])
                nxt += 1
            born = []
            survivors = []
            for tip in tips:
                x, y, d, life, side, age, uid = tip
                if rng.random() * 100 < TURN_PCT:
                    d = (d + rng.choice((1, 7))) & 7
                dist, ox, oy = near_control(x, y)
                if dist < 30 and rng.random() < 0.4:
                    # Follow the control's edge in this tip's own rotation
                    target = int(round(math.atan2(ox * side, -oy * side) / (math.pi / 4))) & 7
                    diff = ((target - d + 4) & 7) - 4
                    if diff:
                        d = (d + (1 if diff > 0 else -1)) & 7
                if not self.open_step(x, y, d):
                    # Blocked: smallest turn that clears, on this tip's own side
                    for k in (1, 2, 3, -1, -2, -3):
                        c = (d + k * side) & 7
                        if self.open_step(x, y, c):
                            d = c
                            break
                    else:
                        continue
                nx, ny = x + DX[d] * STEP, y + DY[d] * STEP
                cell = (int(nx // 9), int(ny // 9))
                seen = self.occ.get(cell)
                self.occ.setdefault(cell, uid)
                self.segs.append((x, y, nx, ny, t, t + dt, uid))
                age += 1
                life -= 1
                # Tips stop on another hypha, as the OLED tips stop at the screen edge
                if life <= 0 or (seen is not None and seen != uid and age > 9 and rng.random() < 0.55):
                    continue
                if rng.random() * 100 < BRANCH_PCT and len(tips) + len(born) < MAX_TIPS:
                    bd = (d + rng.choice((2, 6))) & 7
                    born.append([nx, ny, bd, life * 2 // 3 + 5, rng.choice((1, -1)), 0, self.uid()])
                survivors.append([nx, ny, d, life, side, age, uid])
            tips = survivors + born
            t += dt


def rasterize(segs):
    """Each segment becomes (pixel, coverage, birth). Crossings stay separate entries."""
    pxs, covs, births = [], [], []
    sigma2 = 2 * 0.5 ** 2
    for x0, y0, x1, y1, b0, b1, _ in segs:
        n = max(2, int(math.dist((x0, y0), (x1, y1)) / 0.3))
        best = {}
        for k in range(n + 1):
            f = k / n
            x, y = x0 + (x1 - x0) * f, y0 + (y1 - y0) * f
            b = b0 + (b1 - b0) * f
            ix, iy = int(math.floor(x)), int(math.floor(y))
            for py in range(iy - 1, iy + 3):
                for px in range(ix - 1, ix + 3):
                    if 0 <= px < W and 0 <= py < H:
                        c = math.exp(-((px + 0.5 - x) ** 2 + (py + 0.5 - y) ** 2) / sigma2)
                        if c > 0.03:
                            key = py * W + px
                            if key not in best or c > best[key][0]:
                                best[key] = (c, b)
        for key, (c, b) in best.items():
            pxs.append(key)
            covs.append(c)
            births.append(b)
    return np.array(pxs, np.int64), np.array(covs, np.float32), np.array(births, np.float32) % LOOP


def envelope(age):
    rise = np.clip(age / 0.5, 0, 1)
    settle = 0.62 + 0.38 * np.exp(-age / 4.0)
    tail = np.clip((HOLD + FADE - age) / FADE, 0, 1)
    tail = tail * tail * (3 - 2 * tail)
    return rise * settle * tail


def frame_alpha(t, px, cov, birth):
    a = np.zeros(W * H, np.float32)
    np.maximum.at(a, px, cov * envelope((t - birth) % LOOP))
    return a.reshape(H, W)


GIF_PALETTE = [0, 0, 0]
for lv in range(1, GIF_LEVELS + 1):
    GIF_PALETTE += [int(round(v)) for v in MATTE + (AMBER - MATTE) * (lv / GIF_LEVELS)]


def p_frame(a):
    idx = np.clip(np.floor(a * GIF_LEVELS + 0.35), 0, GIF_LEVELS).astype(np.uint8)
    im = Image.fromarray(idx, "P")
    im.putpalette(GIF_PALETTE)
    im.info["transparency"] = 0
    return im


def rgba_frame(a):
    out = np.zeros((H, W, 4), np.uint8)
    out[..., :3] = AMBER.astype(np.uint8)
    out[..., 3] = np.clip(a * 255, 0, 255).astype(np.uint8)
    return Image.fromarray(out, "RGBA")


def write_gif(net, path):
    px, cov, birth = rasterize(net.segs)
    frames = [p_frame(frame_alpha(i / FPS, px, cov, birth)) for i in range(int(LOOP * FPS))]
    # Disposal 2: pixels that fade out have to return to transparent, so every frame is a full frame
    frames[0].save(path, save_all=True, append_images=frames[1:], duration=int(round(1000 / FPS)),
                   loop=0, disposal=2, transparency=0, optimize=False)


def write_avif(net, path):
    """Real 8-bit alpha, so it works on any plate colour. Needs Pillow 11.3 or newer."""
    px, cov, birth = rasterize(net.segs)
    n = int(LOOP * FPS)
    rest = (rgba_frame(frame_alpha(i / FPS, px, cov, birth)) for i in range(1, n))
    rgba_frame(frame_alpha(0.0, px, cov, birth)).save(path, save_all=True, append_images=rest,
                                                      duration=int(round(1000 / FPS)), loop=0, quality=60, speed=8)


def css_keyframes(grow_s):
    """One shared keyframe list, so a path only stores its delay."""
    ages = sorted({0.0, grow_s, 4.0, 8.0, HOLD, HOLD + FADE * 0.25, HOLD + FADE * 0.5, HOLD + FADE * 0.75, HOLD + FADE})
    stops = []
    for age in ages:
        level = float((0.62 + 0.38 * np.exp(-age / 4.0)) * envelope_tail(age))
        dash = "stroke-dashoffset:1;" if age == 0.0 else "stroke-dashoffset:0;"
        stops.append(f"{age / LOOP * 100:.2f}%{{{dash}opacity:{level:.2f}}}")
    stops.append("100%{stroke-dashoffset:0;opacity:0}")
    return "".join(stops)


def envelope_tail(age):
    tail = min(max((HOLD + FADE - age) / FADE, 0.0), 1.0)
    return tail * tail * (3 - 2 * tail)


def write_svg(net, path, steps=True):
    """CSS animation only, no script. Growth is a dash reveal, the fade is per path.

    Delays are multiples of 1/FPS and the timing is steps(), so every path changes on the same tick.
    The browser repaints FPS times per second, not once per display frame.
    """
    by_tip = {}
    for s in net.segs:
        by_tip.setdefault(s[6], []).append(s)
    paths = []
    for segs in by_tip.values():
        for i in range(0, len(segs), SVG_CHUNK):
            part = segs[i:i + SVG_CHUNK]
            x, y = part[0][0] / STEP, part[0][1] / STEP
            d = f"M{x:.1f} {y:.1f}l"
            moves = []
            for s in part:
                moves.append(f"{round((s[2] - s[0]) / STEP)} {round((s[3] - s[1]) / STEP)}")
            d += " ".join(moves).replace(" -", "-")
            age = (LOOP - part[0][4] % LOOP) % LOOP
            if steps:
                age = round(age * FPS) / FPS
            paths.append(f'<path pathLength="1" d="{d}" style="animation-delay:-{age:g}s"/>')
    timing = f"steps({int(LOOP * FPS)},end)" if steps else "linear"
    css = (f"@keyframes fpHypha{{{css_keyframes(SVG_CHUNK * STEP / SPEED)}}}"
           f".fpHypha path{{fill:none;stroke:{AMBER_HEX};stroke-width:.3;stroke-opacity:.85;stroke-dasharray:1;"
           f"animation:fpHypha {LOOP:g}s {timing} infinite}}")
    path = Path(path)
    path.write_text(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1598.24"><style>{css}</style>'
                    f'<g class="fpHypha" transform="scale({STEP:g})">{"".join(paths)}</g></svg>\n', newline="\n")
    print(f"{len(paths)} paths")


def overlay(draw):
    col = (217, 164, 65, 255)
    for cx, cy in KNOBS:
        draw.ellipse([cx - KNOB_R, cy - KNOB_R, cx + KNOB_R, cy + KNOB_R], outline=col)
    for cx, cy in JACKS:
        draw.ellipse([cx - JACK_R, cy - JACK_R, cx + JACK_R, cy + JACK_R], outline=col)
    for cx, y0, y1 in FADERS:
        draw.rounded_rectangle([cx - FADER_R, y0 - FADER_R, cx + FADER_R, y1 + FADER_R], radius=FADER_R, outline=col)


def write_previews(net, out):
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    px, cov, birth = rasterize(net.segs)
    for t in (0.0, 6.0, 12.0, 18.0):
        base = Image.new("RGBA", (W, H), (0, 0, 0, 255))
        ImageDraw.Draw(base).polygon(net.poly, fill=(20, 20, 20, 255), outline=(217, 164, 65, 255))
        base.alpha_composite(rgba_frame(frame_alpha(t, px, cov, birth)))
        overlay(ImageDraw.Draw(base))
        base.crop((85, 195, 1000, 970)).convert("RGB").save(out / f"preview_{int(t):02d}.png")


def build():
    net = Net(outline())
    net.grow()
    return net


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "gif"
    target = sys.argv[2] if len(sys.argv) > 2 else None
    net = build()
    if mode == "gif":
        path = Path(target or ROOT / "docs" / "faceplate_hyphae.gif")
        write_gif(net, path)
    elif mode == "avif":
        path = Path(target or ROOT / "docs" / "faceplate_hyphae.avif")
        write_avif(net, path)
    elif mode == "svg":
        path = Path(target or ROOT / "docs" / "faceplate_hyphae.svg")
        write_svg(net, path)
    elif mode == "preview":
        path = Path(target or "faceplate_preview")
        write_previews(net, path)
    else:
        sys.exit("usage: faceplate_hyphae.py gif|avif|svg|preview [output]")
    print(path)


if __name__ == "__main__":
    main()
