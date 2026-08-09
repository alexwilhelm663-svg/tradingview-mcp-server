#!/usr/bin/env python3
"""V165: Analyse-Tafel. Chart links, Seitenleiste rechts, Projektion.

Bewusst ein EIGENER Drawer: drawer.py laeuft bei jeder Analyse und bleibt
schlank. Diese Tafel wird nur auf /deep erzeugt.
"""
import sys, json
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
import numpy as np
import pandas as pd

BG, PANEL, GRID = "#0b1220", "#111a2b", "#1e293b"
FG, MUTED = "#e2e8f0", "#94a3b8"
UP, DOWN = "#22c55e", "#ef4444"
WAVE, MW, ZONE = "#38bdf8", "#059669", "#7c3aed"


def money(v):
    a = abs(v)
    if a >= 1e6: return f"{v/1e6:.2f}M"
    if a >= 1e4: return f"{v/1e3:.1f}k"
    if a >= 100: return f"{v:.0f}"
    if a >= 1:   return f"{v:.2f}"
    return f"{v:.4f}"


def main():
    p = json.load(sys.stdin)
    candles = p["candles"]
    if len(candles) < 10:
        sys.exit(1)

    df = pd.DataFrame(candles)
    df["date"] = pd.to_datetime(df["date"])
    df = df.set_index("date")
    for c in ("open", "high", "low", "close"):
        df[c] = df[c].astype(float)

    fig = plt.figure(figsize=(19, 10.5), facecolor=BG)
    gs = fig.add_gridspec(1, 2, width_ratios=[3.05, 1], wspace=0.02,
                          left=0.045, right=0.985, top=0.885, bottom=0.075)
    ax = fig.add_subplot(gs[0, 0], facecolor=BG)
    side = fig.add_subplot(gs[0, 1], facecolor=BG)
    side.axis("off")

    xs = mdates.date2num(df.index.to_pydatetime())
    dx = np.median(np.diff(xs)) if len(xs) > 1 else 1.0
    bw = dx * 0.62
    for xi, (_, r) in zip(xs, df.iterrows()):
        col = UP if r["close"] >= r["open"] else DOWN
        ax.plot([xi, xi], [r["low"], r["high"]], color=col, lw=0.65, zorder=2, alpha=0.95)
        lo, hi = min(r["open"], r["close"]), max(r["open"], r["close"])
        ax.add_patch(plt.Rectangle((xi - bw / 2, lo), bw, max(hi - lo, hi * 1e-3),
                                   facecolor=col, edgecolor=col, lw=0.4, zorder=2, alpha=0.95))
    ax.xaxis_date()
    ax.set_yscale("log")

    d2n = lambda s: mdates.date2num(pd.to_datetime(s).to_pydatetime())
    last_x, span = xs[-1], xs[-1] - xs[0]
    # Projektionsbereich begrenzen: 42 % der Historie waeren bei 5-Jahres-Daten
    # zwei Jahre Leerraum, der das Bild dominiert.
    future = last_x + min(span * 0.22, dx * 90)

    for cl in p.get("clusters", []):
        ax.axhspan(cl["floor"], cl["ceiling"], facecolor=ZONE,
                   alpha=0.10 + 0.03 * min(cl["score"], 4), zorder=1)
        # Label nach INNEN, sonst ragt es in die Seitenleiste.
        ax.text(future, cl["ceiling"], f'{money(cl["floor"])}–{money(cl["ceiling"])} · S{cl["score"]}  ',
                color="#c4b5fd", fontsize=7.8, va="bottom", ha="right", zorder=6)

    waves = p.get("waves", [])
    if len(waves) >= 2:
        wx = [d2n(w["date"]) for w in waves]
        wy = [w["price"] for w in waves]
        ax.plot(wx, wy, color=WAVE, lw=2.4, zorder=5, solid_capstyle="round")
        for x, y, w in zip(wx, wy, waves):
            ax.plot(x, y, "o", color=WAVE, ms=8, zorder=6,
                    markeredgecolor=BG, markeredgewidth=1.4)
            ax.annotate(f'{w["label"]}\n{money(y)}', (x, y), textcoords="offset points",
                        xytext=(0, 15), ha="center", fontsize=9, fontweight="bold",
                        color=FG, zorder=7,
                        bbox=dict(boxstyle="round,pad=0.32", facecolor=PANEL,
                                  edgecolor=WAVE, lw=1.1, alpha=0.95))

    mw = p.get("multiWave", [])
    if len(mw) >= 3:
        ax.plot([d2n(m["date"]) for m in mw], [m["price"] for m in mw],
                color=MW, lw=1.7, zorder=4, alpha=0.95)
        for m in mw:
            if not m["label"]:
                continue
            ax.plot(d2n(m["date"]), m["price"], "o", color=MW, ms=4.5, zorder=5)
            ax.annotate(m["label"], (d2n(m["date"]), m["price"]), textcoords="offset points",
                        xytext=(0, 8 if m["label"] == "1" else -14), ha="center",
                        fontsize=8, fontweight="bold", color=MW, zorder=6)

    ax.axvline(last_x, color=MUTED, ls="--", lw=1.0, alpha=0.55, zorder=3)
    ax.text(last_x, ax.get_ylim()[1], " PROJEKTION · SCHEMATISCH ",
            color=MUTED, fontsize=8.5, va="top", ha="left", zorder=7)

    scen = p.get("scenarios", [])
    for s in scen:
        pts = s["path"]
        n = len(pts)
        px_ = [last_x + (future - last_x) * (i / max(n - 1, 1)) for i in range(n)]
        ax.plot(px_, [q["price"] for q in pts], color=s["color"], lw=2.0,
                ls="--", zorder=5, alpha=0.95)
        for x, q in zip(px_, pts):
            if not q["label"]:
                continue
            ax.plot(x, q["price"], "o", color=s["color"], ms=5, zorder=6)
            ax.annotate(q["label"], (x, q["price"]), textcoords="offset points",
                        xytext=(0, 10), ha="center", fontsize=7.5, color=s["color"], zorder=6)

    for m in p.get("marks", []):
        ax.axhline(m["price"], color=m["color"], ls=":", lw=1.2, alpha=0.85, zorder=4)
        ax.text(xs[0], m["price"], f' {m["label"]} {money(m["price"])}',
                color=m["color"], fontsize=8.5, va="bottom", ha="left", zorder=7)

    ax.set_xlim(xs[0] - dx * 3, future + dx * 6)
    ax.grid(color=GRID, alpha=0.5, lw=0.6)
    ax.tick_params(colors=MUTED, labelsize=9)
    for sp in ax.spines.values():
        sp.set_color(GRID)
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%b\n%Y"))
    ax.yaxis.set_major_formatter(plt.FuncFormatter(lambda v, _: money(v)))

    fig.text(0.045, 0.955, f'{p["symbol"]} · ELLIOTT-WELLEN-ANALYSE',
             color=FG, fontsize=21, fontweight="bold", ha="left")
    fig.text(0.045, 0.918, f'{p["interval"]} ({p["range"]}) · Trend {p["trend"]} · log',
             color=MUTED, fontsize=10.5, ha="left")
    fig.text(0.985, 0.955, money(p["price"]),
             color=UP if p["trend"] == "bullish" else DOWN,
             fontsize=21, fontweight="bold", ha="right")

    def panel(y0, h, title, lines, accent=FG):
        side.add_patch(plt.Rectangle((0.02, y0), 0.96, h, transform=side.transAxes,
                                     facecolor=PANEL, edgecolor=GRID, lw=1.0,
                                     clip_on=False, zorder=1))
        side.text(0.06, y0 + h - 0.028, title, transform=side.transAxes, color=accent,
                  fontsize=10.5, fontweight="bold", va="top", zorder=2)
        for i, (k, v) in enumerate(lines):
            yy = y0 + h - 0.062 - i * 0.030
            if yy < y0 + 0.012:
                break
            side.text(0.06, yy, k, transform=side.transAxes, color=MUTED,
                      fontsize=8.6, va="top", zorder=2)
            side.text(0.94, yy, v, transform=side.transAxes, color=FG, fontsize=8.6,
                      va="top", ha="right", zorder=2, fontweight="bold")

    st = p["struktur"]
    panel(0.72, 0.26, "STRUKTUR", [
        ("Score", st["score"]), ("Anker", st["anker"]), ("ZigZag", st["zigzag"]),
        ("Kontinuität", st["kontinuitaet"]), ("Grad", st["grad"]),
        ("Korrektur-Raster", st["raster"]),
    ], WAVE)

    scen_lines = []
    for s in scen:
        scen_lines.append((s["name"], ""))
        scen_lines.append(("  " + s["note"][:40], ""))
    panel(0.40, 0.28, "SZENARIEN", scen_lines or [("keine Zielzonen", "")], UP)
    for i, s in enumerate(scen):
        side.plot(0.045, 0.40 + 0.28 - 0.068 - i * 0.060, "s", color=s["color"],
                  ms=6, transform=side.transAxes, zorder=3, clip_on=False)

    mark_lines = [(m["label"], money(m["price"])) for m in p.get("marks", [])]
    for cl in p.get("clusters", [])[:4]:
        mark_lines.append((f'Zone S{cl["score"]}', f'{money(cl["floor"])}–{money(cl["ceiling"])}'))
    panel(0.03, 0.33, "ENTSCHEIDUNGSMARKEN", mark_lines, ZONE)

    fig.text(0.045, 0.028,
             f'Stand {p["stand"]} · logarithmische Preisachse · Projektion schematisch, '
             f'keine Kursprognose · keine Anlageberatung',
             color=MUTED, fontsize=8, ha="left")

    fig.savefig(sys.stdout.buffer, format="png", dpi=115, facecolor=BG)


if __name__ == "__main__":
    main()
