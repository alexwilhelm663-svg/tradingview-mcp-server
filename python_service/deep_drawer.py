#!/usr/bin/env python3
"""V171: `/deep` Decision Board mit Makrostruktur und Setup-Zoom.

Der Drawer visualisiert ausschliesslich vom TypeScript-Core gelieferte Levels.
Er erzeugt weder Kursziele noch Wahrscheinlichkeiten oder eine Zeitprojektion.
"""
import json
import sys

import matplotlib
matplotlib.use("Agg")
import matplotlib.dates as mdates
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

BG, PANEL, GRID = "#08111f", "#101b2d", "#243247"
FG, MUTED = "#e5edf7", "#93a4ba"
UP, DOWN = "#22c55e", "#ef4444"
WAVE, MW, CORR = "#38bdf8", "#10b981", "#f43f5e"
ACTIVE, STRONG, WATCH = "#8b5cf6", "#6366f1", "#64748b"


def money(value):
    v = float(value)
    a = abs(v)
    decimals = 4 if a < 1 else 2 if a < 1000 else 0
    raw = f"{v:,.{decimals}f}"
    return raw.replace(",", "X").replace(".", ",").replace("X", ".")


def day(value):
    return str(value or "-")[:10]


def family_name(value):
    return {
        "IMPULSE_RETRACEMENT": "Retrace",
        "PRIOR_WAVE": "W4",
        "ABC_PROJECTION": "ABC",
        "CORRECTION_PATTERN": "Muster",
    }.get(value, str(value))


def status_color(status):
    return {
        "PENDING": "#f59e0b",
        "CONFIRMED": UP,
        "CANDIDATE": "#22d3ee",
        "WATCH": "#f59e0b",
        "WAIT_C": MUTED,
        "OUTSIDE_WINDOW": "#f97316",
        "IMPULSE_ACTIVE": WAVE,
        "NO_SETUP": MUTED,
    }.get(status, MUTED)


def prep_frame(candles):
    df = pd.DataFrame(candles)
    df["date"] = pd.to_datetime(df["date"], utc=True).dt.tz_convert(None)
    df = df.set_index("date").sort_index()
    for col in ("open", "high", "low", "close"):
        df[col] = df[col].astype(float)
    return df


def candle_width(xs):
    if len(xs) < 2:
        return 0.62, 1.0
    dx = float(np.median(np.diff(xs)))
    return dx * 0.62, dx


def draw_candles(ax, df, body_alpha=0.94):
    xs = mdates.date2num(df.index.to_pydatetime())
    bw, dx = candle_width(xs)
    for xi, (_, row) in zip(xs, df.iterrows()):
        color = UP if row["close"] >= row["open"] else DOWN
        ax.plot([xi, xi], [row["low"], row["high"]], color=color,
                lw=0.65, zorder=2, alpha=body_alpha)
        lo, hi = min(row["open"], row["close"]), max(row["open"], row["close"])
        height = max(hi - lo, max(abs(hi), 1.0) * 1e-4)
        ax.add_patch(plt.Rectangle(
            (xi - bw / 2, lo), bw, height,
            facecolor=color, edgecolor=color, lw=0.35,
            zorder=2, alpha=body_alpha,
        ))
    ax.xaxis_date()
    ax.set_yscale("log")
    return xs, dx


def style_axis(ax, title):
    ax.grid(color=GRID, alpha=0.48, lw=0.55)
    ax.tick_params(colors=MUTED, labelsize=8.2)
    for spine in ax.spines.values():
        spine.set_color(GRID)
    ax.yaxis.set_major_formatter(plt.FuncFormatter(lambda value, _: money(value)))
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%b\n%Y"))
    ax.text(0.012, 0.975, title, transform=ax.transAxes, color=FG,
            fontsize=9.5, fontweight="bold", ha="left", va="top",
            bbox=dict(boxstyle="round,pad=0.28", facecolor=PANEL,
                      edgecolor=GRID, alpha=0.94), zorder=12)


def cluster_style(role):
    if role == "ACTIVE":
        return ACTIVE, 0.23, 1.4
    if role == "STRONG":
        return STRONG, 0.12, 0.9
    return WATCH, 0.08, 0.7


def draw_clusters(ax, clusters, label_x=None):
    for cluster in reversed(clusters):
        color, alpha, width = cluster_style(cluster.get("role"))
        ax.axhspan(cluster["floor"], cluster["ceiling"], facecolor=color,
                   edgecolor=color, lw=width, alpha=alpha, zorder=1)
        if label_x is not None and cluster.get("role") in ("ACTIVE", "STRONG"):
            label = (
                f'{money(cluster["floor"])}–{money(cluster["ceiling"])}  '
                f'{cluster["score"]}F/{cluster["evidenceCount"]}E'
            )
            ax.text(label_x, cluster["ceiling"], label, color="#d8ccff",
                    fontsize=7.4, ha="right", va="bottom", zorder=10,
                    bbox=dict(boxstyle="round,pad=0.2", facecolor=BG,
                              edgecolor=color, alpha=0.88))


def wave_offset(label, trend):
    try:
        n = int(label)
    except (TypeError, ValueError):
        return 13
    high = (n % 2 == 1) if trend == "bullish" else (n % 2 == 0)
    return 14 if high else -26


def draw_waves(ax, waves, trend, date_to_num, labels=True):
    if len(waves) < 2:
        return
    wx = [date_to_num(w["date"]) for w in waves]
    wy = [w["price"] for w in waves]
    ax.plot(wx, wy, color=WAVE, lw=2.2, zorder=5, solid_capstyle="round")
    for x, y, wave in zip(wx, wy, waves):
        ax.plot(x, y, "o", color=WAVE, ms=6.6, zorder=6,
                markeredgecolor=BG, markeredgewidth=1.2)
        if not labels:
            continue
        offset = wave_offset(wave.get("label"), trend)
        ax.annotate(
            f'{wave["label"]}  {money(y)}', (x, y), textcoords="offset points",
            xytext=(0, offset), ha="center", va="bottom" if offset > 0 else "top",
            fontsize=7.8, fontweight="bold", color=FG, zorder=8,
            bbox=dict(boxstyle="round,pad=0.25", facecolor=PANEL,
                      edgecolor=WAVE, lw=0.9, alpha=0.94),
        )


def draw_correction(ax, correction, waves, trend, date_to_num):
    if len(correction) < 2:
        return
    cx = [date_to_num(c["date"]) for c in correction]
    cy = [c["price"] for c in correction]
    if waves:
        cx = [date_to_num(waves[-1]["date"])] + cx
        cy = [waves[-1]["price"]] + cy
    ax.plot(cx, cy, color=CORR, lw=1.9, ls="--", zorder=5, alpha=0.96)
    for index, point in enumerate(correction):
        x, y = date_to_num(point["date"]), point["price"]
        ax.plot(x, y, "o", color=CORR, ms=6.2, zorder=6,
                markeredgecolor=BG, markeredgewidth=1.0)
        high = (index % 2 == 1) if trend == "bullish" else (index % 2 == 0)
        offset = 12 if high else -20
        ax.annotate(point["label"], (x, y), textcoords="offset points",
                    xytext=(0, offset), ha="center",
                    va="bottom" if offset > 0 else "top",
                    fontsize=8.8, fontweight="bold", color=CORR, zorder=8)


def draw_provisional(ax, provisional, anchors, date_to_num):
    if not provisional:
        return
    x = date_to_num(provisional["date"])
    y = provisional["price"]
    prior = [a for a in anchors if str(a.get("date", "")) < str(provisional["date"])]
    if prior:
        anchor = max(prior, key=lambda item: str(item.get("date", "")))
        ax.plot([date_to_num(anchor["date"]), x], [anchor["price"], y],
                color=MUTED, lw=1.2, ls=(0, (3, 3)), alpha=0.75, zorder=4)
    ax.plot(x, y, marker="D", ms=7, markerfacecolor=BG,
            markeredgecolor=MUTED, markeredgewidth=1.4, zorder=7)
    ax.annotate(f'{provisional["label"]} · vorläufig', (x, y),
                textcoords="offset points", xytext=(8, 9), ha="left",
                fontsize=7.4, color=MUTED, zorder=8,
                bbox=dict(boxstyle="round,pad=0.2", facecolor=BG,
                          edgecolor=MUTED, alpha=0.9))


def draw_multi_wave(ax, points, date_to_num):
    if len(points) < 3:
        return
    xx = [date_to_num(point["date"]) for point in points]
    yy = [point["price"] for point in points]
    ax.plot(xx, yy, color=MW, lw=1.5, zorder=4, alpha=0.9)
    for point in points:
        if not point.get("label"):
            continue
        ax.plot(date_to_num(point["date"]), point["price"], "o",
                color=MW, ms=4.2, zorder=5)


def draw_marks(ax, marks, right_x):
    styles = {"solid": "-", "dash": "--", "dot": ":"}
    for mark in marks:
        style = styles.get(mark.get("style"), ":")
        ax.axhline(mark["price"], color=mark["color"], ls=style,
                   lw=1.15, alpha=0.88, zorder=4)
        ax.text(right_x, mark["price"],
                f' {mark["label"]}  {money(mark["price"])} ',
                color=mark["color"], fontsize=7.3, va="bottom", ha="right",
                zorder=11, bbox=dict(boxstyle="round,pad=0.18", facecolor=BG,
                                    edgecolor=mark["color"], alpha=0.9))


def panel(side, y0, height, title, lines, accent=FG):
    side.add_patch(plt.Rectangle(
        (0.02, y0), 0.96, height, transform=side.transAxes,
        facecolor=PANEL, edgecolor=GRID, lw=1.0, clip_on=False, zorder=1,
    ))
    side.text(0.055, y0 + height - 0.027, title, transform=side.transAxes,
              color=accent, fontsize=9.6, fontweight="bold", va="top", zorder=2)
    usable = max(height - 0.072, 0.04)
    step = usable / max(len(lines), 1)
    for index, (key, value, color) in enumerate(lines):
        yy = y0 + height - 0.064 - index * step
        side.text(0.055, yy, key, transform=side.transAxes, color=MUTED,
                  fontsize=7.6, va="top", zorder=2)
        side.text(0.945, yy, value, transform=side.transAxes,
                  color=color or FG, fontsize=7.6, va="top", ha="right",
                  fontweight="bold", zorder=2)


def main():
    payload = json.load(sys.stdin)
    candles = payload.get("candles", [])
    if len(candles) < 10:
        sys.exit(1)

    df = prep_frame(candles)
    zoom_from = pd.to_datetime(payload.get("zoomFrom"), utc=True).tz_convert(None)
    zoom_df = df[df.index >= zoom_from]
    if len(zoom_df) < 20:
        zoom_df = df.tail(min(52, len(df)))

    fig = plt.figure(figsize=(20, 12), facecolor=BG)
    grid = fig.add_gridspec(
        2, 2, width_ratios=[3.28, 1], height_ratios=[1.0, 1.16],
        hspace=0.085, wspace=0.025,
        left=0.045, right=0.985, top=0.86, bottom=0.072,
    )
    macro = fig.add_subplot(grid[0, 0], facecolor=BG)
    zoom = fig.add_subplot(grid[1, 0], facecolor=BG)
    side = fig.add_subplot(grid[:, 1], facecolor=BG)
    side.axis("off")

    date_to_num = lambda value: mdates.date2num(pd.to_datetime(value, utc=True).tz_convert(None).to_pydatetime())
    waves = payload.get("waves", [])
    correction = payload.get("correction", [])
    clusters = payload.get("clusters", [])

    macro_x, macro_dx = draw_candles(macro, df, 0.88)
    draw_clusters(macro, clusters)
    draw_waves(macro, waves, payload.get("trend"), date_to_num, labels=True)
    draw_correction(macro, correction, waves, payload.get("trend"), date_to_num)
    draw_provisional(macro, payload.get("provisional"), waves + correction, date_to_num)
    macro.set_xlim(macro_x[0] - 2 * macro_dx, macro_x[-1] + 10 * macro_dx)
    style_axis(macro, "1 · MAKROSTRUKTUR · BESTÄTIGTE ZÄHLUNG")
    macro.text(0.988, 0.975, "● bestätigt   ◇ vorläufig",
               transform=macro.transAxes, color=MUTED, fontsize=7.4,
               ha="right", va="top", zorder=12)

    zoom_x, zoom_dx = draw_candles(zoom, zoom_df, 0.98)
    right_x = zoom_x[-1] + 9.5 * zoom_dx
    draw_clusters(zoom, clusters, right_x)
    visible_waves = [w for w in waves if str(w["date"]) >= str(payload.get("zoomFrom"))]
    draw_waves(zoom, visible_waves, payload.get("trend"), date_to_num, labels=True)
    draw_correction(zoom, correction, waves, payload.get("trend"), date_to_num)
    draw_multi_wave(zoom, payload.get("multiWave", []), date_to_num)
    draw_provisional(zoom, payload.get("provisional"), waves + correction, date_to_num)
    draw_marks(zoom, payload.get("marks", []), right_x)
    zoom.set_xlim(zoom_x[0] - 2 * zoom_dx, zoom_x[-1] + 12 * zoom_dx)
    style_axis(zoom, "2 · SETUP-ZOOM · KEINE ZEITPROJEKTION")

    decision = payload["decision"]
    evidence = payload["evidence"]
    provenance = payload["provenance"]
    accent = status_color(decision["status"])
    price_color = UP if payload.get("trend") == "bullish" else DOWN

    fig.text(0.045, 0.954, f'{payload["symbol"]} · DEEP DECISION BOARD',
             color=FG, fontsize=21, fontweight="bold", ha="left")
    fig.text(0.045, 0.918,
             f'{payload["interval"]} ({payload["range"]}) · Makrotrend {payload["trend"]} · '
             f'Zählung {evidence["countScore"]} · Grad {evidence["degree"]}',
             color=MUTED, fontsize=10.2, ha="left")
    fig.text(0.57, 0.951, decision["statusLabel"], color=accent,
             fontsize=10.0, fontweight="bold", ha="center", va="center",
             bbox=dict(boxstyle="round,pad=0.45", facecolor=PANEL,
                       edgecolor=accent, lw=1.2, alpha=0.98))
    fig.text(0.985, 0.954, money(payload["price"]),
             color=price_color, fontsize=21, fontweight="bold", ha="right")

    status_lines = [
        ("Status", decision["status"], accent),
        ("Richtung", decision["direction"], FG),
        ("Modus", "FROZEN" if decision["frozen"] else "AKTUELL", accent),
        ("Datenstand", day(provenance["dataAsOf"]), FG),
        ("Snapshot", str(decision.get("snapshotId") or "-")[:12], FG),
    ]
    panel(side, 0.79, 0.19, "STATUS", status_lines, accent)

    zone = decision.get("zone")
    decision_lines = []
    if zone:
        decision_lines.append(("Zone", f'{money(zone["floor"])}–{money(zone["ceiling"])}', ACTIVE))
    if decision.get("entry") is not None:
        decision_lines.append(("Entry", money(decision["entry"]), FG))
    if decision.get("trigger") is not None:
        op = ">" if decision["direction"] == "LONG" else "<"
        decision_lines.append(("Trigger Schluss", f'{op} {money(decision["trigger"])}', UP))
    if decision.get("invalidation") is not None:
        op = "<" if decision["direction"] == "LONG" else ">"
        decision_lines.append(("Invalidierung", f'{op} {money(decision["invalidation"])}', DOWN))
    if decision.get("target") is not None:
        decision_lines.append(("Modellziel", money(decision["target"]), WAVE))
    if decision.get("potentialR") is not None:
        decision_lines.append(("Potenzial", f'{decision["potentialR"]:.2f} R', FG))
    for rule in payload.get("rules", [])[:2]:
        decision_lines.append((rule["name"], f'{rule["condition"]} → {rule["result"]}', rule["color"]))
    if not decision_lines:
        decision_lines = [("Aktion", "NO TRADE", MUTED)]
    panel(side, 0.49, 0.28, "ENTSCHEIDUNGSLEVEL", decision_lines[:8], UP)

    families = ", ".join(family_name(x) for x in (zone or {}).get("families", [])) or "-"
    strength = (
        f'{zone["score"]} Familien / {zone["evidenceCount"]} Evidenzen'
        if zone else "keine aktive Zone"
    )
    time_window = evidence.get("timeWindow")
    time_value = evidence.get("timeStatus", "UNKNOWN")
    if time_window:
        time_value += f' · {day(time_window["from"])}–{day(time_window["to"])}'
    evidence_lines = [
        ("Zonenstärke", strength, FG),
        ("Familien", families, FG),
        ("Count-Stabilität", evidence["countStability"], FG),
        ("Kontinuität", evidence["continuity"], FG),
        ("Qualität", evidence["quality"], FG),
        ("C-Zeit", time_value, FG),
    ]
    panel(side, 0.255, 0.215, "EVIDENZ · KEINE WAHRSCHEINLICHKEIT", evidence_lines, WAVE)

    provisional = payload.get("provisional")
    flags = evidence.get("qualityFlags", [])
    risk_lines = [
        ("Korrektur", evidence.get("correctionPattern") or "n/a", FG),
        ("Umschlagrisiko", evidence.get("reversalRisk") or "NONE", FG),
        ("Letzter Pivot bestätigt", day(evidence.get("lastConfirmedPivot")), FG),
        ("Vorläufiges Extrem", money(provisional["price"]) if provisional else "keins", MUTED),
        ("Qualitätsflags", ", ".join(flags[:2]) if flags else "keine", DOWN if flags else FG),
        ("Datenhash", str(provenance.get("dataHash", "-"))[:12], FG),
    ]
    panel(side, 0.03, 0.205, "RISIKO & PROVENIENZ", risk_lines, DOWN)

    fig.text(
        0.045, 0.027,
        f'Datenstand {day(provenance["dataAsOf"])} · {provenance["provider"]} · '
        f'{"nur geschlossene Bars" if provenance["closedBarsOnly"] else "offene Bars enthalten"} · '
        f'Engine {decision["engineVersion"]} · keine Zeitprojektion · keine Anlageberatung',
        color=MUTED, fontsize=7.8, ha="left",
    )
    fig.savefig(sys.stdout.buffer, format="png", dpi=155, facecolor=BG,
                bbox_inches=None, metadata={"Software": "EW Quant Hunter V171"})


if __name__ == "__main__":
    main()
