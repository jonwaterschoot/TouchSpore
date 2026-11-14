#!/usr/bin/env python3
"""Looping hyphae overlay for video, grown around the bright shapes of a still with the tip rules of ui/spore_boot.cpp.

    pip install numpy opencv-python      (and ffmpeg on PATH)
    python tools/overlay_hyphae.py preview still.jpg [dir]       # PNGs over the darkened still, plus the shape mask
    python tools/overlay_hyphae.py alpha   still.jpg [out.mov]   # ProRes 4444 with straight alpha
    python tools/overlay_hyphae.py black   still.jpg [out.mp4]   # H.264, lines on black for Screen or Add blending

Output has the still's resolution. Objects are the regions where the blurred luminance rises above
THRESHOLD, so this suits a dark scene with lit objects. Tips grow in the dark space, stop short of the
objects and turn to follow their edges part of the time.

Every pixel of the network stores the time a tip reached it. Its level is a function of
(t - birth) mod LOOP, so the last frame runs into the first with no cut.
"""
import math
import random
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np

AMBER = np.array([217, 164, 65], np.float32)   # RGB

# Boot screen rules (ui/spore_boot.cpp)
TURN_PCT, BRANCH_PCT, MAX_TIPS = 25, 7, 220
DX = [1, 1, 0, -1, -1, -1, 0, 1]
DY = [0, 1, 1, 1, 0, -1, -1, -1]

STEP = 7.0            # px per boot-screen pixel at 3840 wide
SPEED = 26.0          # px/s of tip growth
LOOP = 30.0           # s
FPS = 25
HOLD = 14.0           # s before the fade starts
FADE = 10.0           # s from HOLD to nothing. HOLD + FADE must stay below LOOP
SEEDS = 120
EDGE_SEED_PART = 0.08 # share of seeds on the frame border. The rest start on object contours
LIFE = (80, 170)      # steps
SEED_VALUE = 11       # change for a different network

THRESHOLD = 14        # blurred luminance (0–255) that counts as object
BLUR = 14             # px sigma before the threshold. Larger gives rounder, looser shapes
CLOSE = 81            # px closing kernel. Merges the bright parts of one device into one shape
MARGIN = 12           # px a tip keeps from an object
FOLLOW = 160          # px from an object where tips start to turn along its edge
FOLLOW_P = 0.45       # chance per step to turn toward the edge tangent inside FOLLOW
NEAR = 260            # px. Beyond this distance from any object tips start to die off
FAR_DIE = 0.06        # chance per step to stop, reached at NEAR + 600 px

LINE_SIGMA = 1.1      # px. Line width is about 2.5 sigma
GLOW = 0.35           # strength of a soft halo (0 for none)
GLOW_SIGMA = 7.0      # px


def load(path):
    im = cv2.imread(str(path))
    if im is None:
        sys.exit(f"cannot read {path}")
    return im


def shape_mask(im):
    lum = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY).astype(np.float32)
    solid = (cv2.GaussianBlur(lum, (0, 0), BLUR) > THRESHOLD).astype(np.uint8)
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (CLOSE, CLOSE))
    solid = cv2.morphologyEx(solid, cv2.MORPH_CLOSE, k)
    # Drop specks such as LEDs and cable glints, and fill holes so panels count as one object
    contours, _ = cv2.findContours(solid, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    out = np.zeros_like(solid)
    big = [c for c in contours if cv2.contourArea(c) > 2500]
    cv2.drawContours(out, big, -1, 1, thickness=cv2.FILLED)
    return out


class Net:
    def __init__(self, solid):
        self.h, self.w = solid.shape
        self.solid = solid
        # Distance from each background pixel to the nearest object, and its gradient (points away from it)
        self.dist = cv2.distanceTransform((1 - solid).astype(np.uint8), cv2.DIST_L2, 5)
        smooth = cv2.GaussianBlur(self.dist, (0, 0), 6)
        self.gx = cv2.Sobel(smooth, cv2.CV_32F, 1, 0, ksize=3)
        self.gy = cv2.Sobel(smooth, cv2.CV_32F, 0, 1, ksize=3)
        self.rng = random.Random(SEED_VALUE)
        self.segs = []        # x0, y0, x1, y1, birth0, birth1
        self.occ = {}
        self.cell = STEP * 2.6
        self.next_uid = 0

    def uid(self):
        self.next_uid += 1
        return self.next_uid

    def clear(self, x, y):
        ix, iy = int(round(x)), int(round(y))
        if ix < 4 or iy < 4 or ix >= self.w - 4 or iy >= self.h - 4:
            return False
        return self.dist[iy, ix] >= MARGIN

    def open_step(self, x, y, d):
        nx, ny = x + DX[d] * STEP, y + DY[d] * STEP
        return self.clear(nx, ny) and self.clear((x + nx) / 2, (y + ny) / 2)

    def seed_points(self):
        rng = self.rng
        out = []
        n_edge = int(SEEDS * EDGE_SEED_PART)
        w, h = self.w, self.h
        per = 2 * (w + h)
        for k in range(n_edge):
            s = (k + rng.random()) / n_edge * per
            if s < w:
                out.append((s, 6.0, math.pi / 2))
            elif s < w + h:
                out.append((w - 6.0, s - w, math.pi))
            elif s < 2 * w + h:
                out.append((2 * w + h - s, h - 6.0, -math.pi / 2))
            else:
                out.append((6.0, per - s, 0.0))
        # Contour seeds: points just outside the objects, weighted by contour length
        ring = ((self.dist > MARGIN + 2) & (self.dist < MARGIN + 4)).astype(np.uint8)
        ring[:12, :] = ring[-12:, :] = 0
        ring[:, :12] = ring[:, -12:] = 0
        ys, xs = np.nonzero(ring)
        order = list(range(len(xs)))
        rng.shuffle(order)
        picked = []
        for i in order:
            x, y = float(xs[i]), float(ys[i])
            if all(math.hypot(x - px, y - py) > 120 for px, py in picked):
                picked.append((x, y))
                if len(picked) >= SEEDS - n_edge:
                    break
        for x, y in picked:
            gx, gy = self.gx[int(y), int(x)], self.gy[int(y), int(x)]
            out.append((x, y, math.atan2(gy, gx)))
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
                ix, iy = int(x), int(y)
                if self.dist[iy, ix] < FOLLOW and rng.random() < FOLLOW_P:
                    # Follow the object's edge in this tip's own rotation
                    ox, oy = self.gx[iy, ix], self.gy[iy, ix]
                    if ox or oy:
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
                cell = (int(nx // self.cell), int(ny // self.cell))
                seen = self.occ.get(cell)
                self.occ.setdefault(cell, uid)
                self.segs.append((x, y, nx, ny, t, t + dt))
                age += 1
                life -= 1
                # Tips stop on another hypha, as the OLED tips stop at the screen edge
                if life <= 0 or (seen is not None and seen != uid and age > 9 and rng.random() < 0.55):
                    continue
                # Open table far from the objects thins the network out
                far = (self.dist[int(ny), int(nx)] - NEAR) / 600
                if far > 0 and rng.random() < FAR_DIE * min(far, 1.0):
                    continue
                if rng.random() * 100 < BRANCH_PCT and len(tips) + len(born) < MAX_TIPS:
                    bd = (d + rng.choice((2, 6))) & 7
                    born.append([nx, ny, bd, life * 2 // 3 + 5, rng.choice((1, -1)), 0, self.uid()])
                survivors.append([nx, ny, d, life, side, age, uid])
            tips = survivors + born
            t += dt
        print(f"{len(self.segs)} segments over {t:.0f} s of growth")


def rasterize(segs, w, h):
    """Gaussian splats along every segment. Returns entries sorted by pixel, with one entry per
    (pixel, birth frame) at its highest coverage, so crossings at different times stay separate."""
    segs = np.array(segs, np.float32)
    r = int(math.ceil(3 * LINE_SIGMA))
    offs = np.arange(-r, r + 1)
    oy, ox = [a.ravel() for a in np.meshgrid(offs, offs, indexing="ij")]
    n = int(STEP * 1.5 / 0.35) + 1
    f = np.linspace(0, 1, n, dtype=np.float32)
    nb = int(LOOP * FPS)
    keys, covs = [], []
    for c0 in range(0, len(segs), 3000):
        s = segs[c0:c0 + 3000]
        x = (s[:, 0:1] + (s[:, 2:3] - s[:, 0:1]) * f).ravel()
        y = (s[:, 1:2] + (s[:, 3:4] - s[:, 1:2]) * f).ravel()
        b = (s[:, 4:5] + (s[:, 5:6] - s[:, 4:5]) * f).ravel()
        bq = np.round((b % LOOP) * FPS).astype(np.int64) % nb
        px = np.floor(x).astype(np.int64)[:, None] + ox
        py = np.floor(y).astype(np.int64)[:, None] + oy
        c = np.exp(-((px + 0.5 - x[:, None]) ** 2 + (py + 0.5 - y[:, None]) ** 2) / (2 * LINE_SIGMA ** 2))
        ok = (c > 0.02) & (px >= 0) & (py >= 0) & (px < w) & (py < h)
        k = ((py * w + px) * nb + bq[:, None])[ok]
        c = c[ok].astype(np.float32)
        k, c = max_by_key(k, c)
        keys.append(k)
        covs.append(c)
    k, c = max_by_key(np.concatenate(keys), np.concatenate(covs))
    pix, bq = k // nb, k % nb
    print(f"{len(k)} pixel entries")
    return pix, c, (bq / FPS).astype(np.float32)


def max_by_key(k, c):
    o = np.argsort(k, kind="stable")
    k, c = k[o], c[o]
    starts = np.flatnonzero(np.r_[True, k[1:] != k[:-1]])
    return k[starts], np.maximum.reduceat(c, starts)


def envelope(age):
    rise = np.clip(age / 0.4, 0, 1)
    settle = 0.62 + 0.38 * np.exp(-age / 4.0)
    tail = np.clip((HOLD + FADE - age) / FADE, 0, 1)
    tail = tail * tail * (3 - 2 * tail)
    return rise * settle * tail


class Frames:
    def __init__(self, pix, cov, birth, w, h):
        self.w, self.h = w, h
        self.cov, self.birth = cov, birth
        self.starts = np.flatnonzero(np.r_[True, pix[1:] != pix[:-1]])
        self.upix = pix[self.starts]

    def alpha(self, t):
        v = self.cov * envelope((t - self.birth) % LOOP)
        a = np.zeros(self.w * self.h, np.float32)
        a[self.upix] = np.maximum.reduceat(v, self.starts)
        a = a.reshape(self.h, self.w)
        if GLOW:
            g = cv2.GaussianBlur(a, (0, 0), GLOW_SIGMA) * (GLOW * 2.5)
            a = 1 - (1 - a) * (1 - np.clip(g, 0, 1))
        return np.clip(a, 0, 1)


def build(still):
    im = load(still)
    solid = shape_mask(im)
    net = Net(solid)
    net.grow()
    h, w = solid.shape
    return im, solid, Frames(*rasterize(net.segs, w, h), w, h)


def encode(frames, cmd, to_bytes):
    n = int(LOOP * FPS)
    p = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    for i in range(n):
        p.stdin.write(to_bytes(frames.alpha(i / FPS)))
        if i % FPS == 0:
            print(f"\r{i / FPS:.0f}/{LOOP:.0f} s", end="", flush=True)
    p.stdin.close()
    p.wait()
    print()
    if p.returncode:
        sys.exit("ffmpeg failed")


def raw_in(w, h, fmt):
    return ["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", fmt,
            "-s", f"{w}x{h}", "-r", str(FPS), "-i", "-"]


def write_alpha(frames, path):
    """Straight alpha: RGB is amber everywhere, alpha carries the lines."""
    w, h = frames.w, frames.h
    rgba = np.empty((h, w, 4), np.uint8)
    rgba[..., :3] = AMBER.astype(np.uint8)

    def to_bytes(a):
        rgba[..., 3] = (a * 255 + 0.5).astype(np.uint8)
        return rgba.tobytes()

    cmd = raw_in(w, h, "rgba") + ["-c:v", "prores_ks", "-profile:v", "4444", "-pix_fmt", "yuva444p10le",
                                  "-alpha_bits", "16", "-vendor", "apl0", str(path)]
    encode(frames, cmd, to_bytes)


def write_black(frames, path):
    w, h = frames.w, frames.h

    def to_bytes(a):
        return (a[..., None] * AMBER + 0.5).astype(np.uint8).tobytes()

    cmd = raw_in(w, h, "rgb24") + ["-c:v", "libx264", "-preset", "slow", "-crf", "12", "-pix_fmt", "yuv420p",
                                   "-movflags", "+faststart", str(path)]
    encode(frames, cmd, to_bytes)


def write_previews(im, solid, frames, out):
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    edge = cv2.morphologyEx(solid, cv2.MORPH_GRADIENT, np.ones((5, 5), np.uint8)) > 0
    for t in (0.0, LOOP * 0.25, LOOP * 0.5, LOOP * 0.75):
        a = frames.alpha(t)[..., None]
        base = im.astype(np.float32) * 0.6
        lines = base * (1 - a) + AMBER[::-1] * a
        cv2.imwrite(str(out / f"overlay_{t:04.1f}s.jpg"), lines.astype(np.uint8), [cv2.IMWRITE_JPEG_QUALITY, 90])
        cv2.imwrite(str(out / f"lines_{t:04.1f}s.png"), (a[..., 0] * 255).astype(np.uint8))
    m = im.copy()
    m[edge] = (0, 0, 255)
    cv2.imwrite(str(out / "mask.jpg"), m, [cv2.IMWRITE_JPEG_QUALITY, 85])


def main():
    if len(sys.argv) < 3:
        sys.exit("usage: overlay_hyphae.py preview|alpha|black still.jpg [output]")
    mode, still = sys.argv[1], Path(sys.argv[2])
    target = sys.argv[3] if len(sys.argv) > 3 else None
    im, solid, frames = build(still)
    if mode == "preview":
        path = Path(target or still.parent / "hyphae_preview")
        write_previews(im, solid, frames, path)
    elif mode == "alpha":
        path = Path(target or still.with_name(still.stem + "_hyphae_alpha.mov"))
        write_alpha(frames, path)
    elif mode == "black":
        path = Path(target or still.with_name(still.stem + "_hyphae_black.mp4"))
        write_black(frames, path)
    else:
        sys.exit("usage: overlay_hyphae.py preview|alpha|black still.jpg [output]")
    print(path)


if __name__ == "__main__":
    main()
