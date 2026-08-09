#!/usr/bin/env python3
"""V167: Korrektur-Detail. Binnenzaehlung je Bein + Vollstaendigkeitspruefung."""
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
CORR, SUB = "#f43f5e", "#fb923c"
ST = {"REIF": "#22c55e", "OK": "#eab308", "OFFEN": "#94a3b8"}


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
    if len(candles) < 5:
        sys.exit(1)

    df = pd.DataFrame(candles)
    df["date"] = pd.to_datetime(df["date"])
    df = df.set_index("date")
    for c in ("open", "high", "low", "close"):
        df[c] = df[c].astype(float)

    fig = plt.figure(figsize=(19, 7.6), facecolor=BG)
    gs = fig.add_gridspec(1, 2, width_ratios=[3.05, 1], wspace=0.02,
                          left=0.045, right=0.985, top=0.855, bottom=0.095)
    ax = fig.add_subplot(gs[0, 0], facecolor=BG)
    side = fig.add_subplot(gs[0, 1], facecolor=BG)
    side.axis("off")

    xs = mdates.date2num(df.index.to_pydatetime())
    dx = np.median(np.diff(xs)) if len(xs) > 1 else 1.0
    bw = dx * 0.62
    for xi, (_, r) in zip(xs, df.iterrows()):
        col = UP if r["close"] >= r["open"] else DOWN
        ax.plot([xi, xi], [r["low"], r["high"]], color=col, lw=0.8, zorder=2, alpha=0.9)
        lo, hi = min(r["open"], r["close"]), max(r["open"], r["close"])
        ax.add_patch(plt.Rectangle((xi - bw / 2, lo), bw, max(hi - lo, hi * 1e-3),
                                   facecolor=col, edgecolor=col, lw=0.4, zorder=2, alpha=0.9))
    ax.xaxis_date()
    ax.set_yscale("log")
    d2n = lambda s: mdates.date2num(pd.to_datetime(s).to_pydatetime())

    # Hauptbeine der Korrektur
    legs = p["legs"]
    px = [d2n(p["anchor"]["date"])]
    py = [p["anchor"]["price"]]
    for lg in legs:
        px.append(d2n(lg["toDate"]))
        py.append(lg["toPrice"])
    ax.plot(px, py, color=CORR, lw=2.6, zorder=5, solid_capstyle="round")
    for lg in legs:
        x, y = d2n(lg["toDate"]), lg["toPrice"]
        ax.plot(x, y, "o", color=CORR, ms=10, zorder=6,
                markeredgecolor=BG, markeredgewidth=1.5)
        ax.annotate(f'{lg["label"]}\n{money(y)}', (x, y), textcoords="offset points",
                    xytext=(0, -30), ha="center", fontsize=11, fontweight="bold",
                    color=FG, zorder=7,
                    bbox=dict(boxstyle="round,pad=0.32", facecolor=PANEL,
                              edgecolor=CORR, lw=1.2, alpha=0.95))

    # Binnenzaehlung: a-b-c innerhalb jedes Beins
    for lg in legs:
        for s in lg["subs"]:
            x, y = d2n(s["date"]), s["price"]
            ax.plot(x, y, "o", color=SUB, ms=4.5, zorder=4)
            ax.annotate(s["label"], (x, y), textcoords="offset points", xytext=(0, 9),
                        ha="center", fontsize=8.5, color=SUB, fontweight="bold", zorder=5)

    # Bruchmarke
    ax.axhline(p["breakLevel"], color="#eab308", ls="--", lw=1.3, alpha=0.9, zorder=3)
    ax.text(xs[0], p["breakLevel"], f'  Korrektur beendet über {money(p["breakLevel"])}'
            if p["price"] < p["breakLevel"] else f'  Bruchmarke {money(p["breakLevel"])}',
            color="#eab308", fontsize=9, va="bottom", ha="left", zorder=7)
    if p.get("ziel"):
        ax.axhline(p["ziel"], color="#38bdf8", ls=":", lw=1.3, alpha=0.9, zorder=3)
        ax.text(xs[0], p["ziel"], f'  Ziel {money(p["ziel"])} ({p.get("zielLabel") or ""})',
                color="#38bdf8", fontsize=9, va="bottom", ha="left", zorder=7)

    ax.grid(color=GRID, alpha=0.5, lw=0.6)
    ax.tick_params(colors=MUTED, labelsize=9)
    for sp in ax.spines.values():
        sp.set_color(GRID)
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%b %Y"))
    ax.yaxis.set_major_formatter(plt.FuncFormatter(lambda v, _: money(v)))

    fig.text(0.045, 0.945, f'{p["symbol"]} · KORREKTUR-DETAIL',
             color=FG, fontsize=18, fontweight="bold", ha="left")
    sub = " · ".join(f'{lg["label"]} {lg["subCount"]}-teilig' for lg in legs)
    fig.text(0.045, 0.900, f'{p["pattern"]} · {sub}', color=MUTED, fontsize=10, ha="left")

    # Seitenleiste
    def panel(y0, h, title, rows, accent=FG):
        side.add_patch(plt.Rectangle((0.02, y0), 0.96, h, transform=side.transAxes,
                                     facecolor=PANEL, edgecolor=GRID, lw=1.0,
                                     clip_on=False, zorder=1))
        side.text(0.06, y0 + h - 0.04, title, transform=side.transAxes, color=accent,
                  fontsize=10.5, fontweight="bold", va="top", zorder=2)
        for i, (k, v, col) in enumerate(rows):
            yy = y0 + h - 0.095 - i * 0.048
            if yy < y0 + 0.02:
                break
            side.text(0.06, yy, k, transform=side.transAxes, color=MUTED,
                      fontsize=8.8, va="top", zorder=2)
            side.text(0.94, yy, v, transform=side.transAxes, color=col,
                      fontsize=8.8, va="top", ha="right", zorder=2, fontweight="bold")

    rows = [(c["label"], f'{c["wert"]}  {c["status"]}', ST.get(c["status"], FG))
            for c in p["checks"]]
    panel(0.50, 0.46, "IST DIE KORREKTUR AUSGEREIZT?", rows, CORR)

    reif = sum(1 for c in p["checks"] if c["status"] == "REIF")
    fazit_col = "#22c55e" if (p["broken"] or reif >= 3) else "#eab308" if reif >= 2 else MUTED
    side.add_patch(plt.Rectangle((0.02, 0.20), 0.96, 0.24, transform=side.transAxes,
                                 facecolor=PANEL, edgecolor=GRID, lw=1.0, clip_on=False, zorder=1))
    side.text(0.06, 0.40, "FAZIT", transform=side.transAxes, color=fazit_col,
              fontsize=10.5, fontweight="bold", va="top", zorder=2)
    words = p["fazit"].split()
    lines, cur = [], ""
    for w in words:
        if len(cur) + len(w) > 26:
            lines.append(cur); cur = w
        else:
            cur = (cur + " " + w).strip()
    if cur:
        lines.append(cur)
    for i, ln in enumerate(lines[:4]):
        side.text(0.06, 0.345 - i * 0.048, ln, transform=side.transAxes, color=FG,
                  fontsize=9.2, va="top", zorder=2)
    side.text(0.06, 0.345 - len(lines[:4]) * 0.048 - 0.01,
              f'{reif} von {len(p["checks"])} Kriterien reif',
              transform=side.transAxes, color=MUTED, fontsize=8.4, va="top", zorder=2)

    fig.text(0.045, 0.032,
             f'Stand {p["stand"]} · Binnenzählung je Korrekturbein · '
             f'Reifegrad ist keine Prognose · keine Anlageberatung',
             color=MUTED, fontsize=8, ha="left")

    fig.savefig(sys.stdout.buffer, format="png", dpi=115, facecolor=BG)


if __name__ == "__main__":
    main()
