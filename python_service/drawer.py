import sys
import json
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import io
import warnings

warnings.filterwarnings("ignore")


def main():
    try:
        input_data = sys.stdin.read()
        payload = json.loads(input_data)

        symbol = payload.get("symbol", "UNKNOWN").upper()
        waves = payload.get("waves", [])
        candles = payload.get("candles", [])

        if not candles:
            sys.exit(1)

        df = pd.DataFrame(candles)
        df["date"] = pd.to_datetime(df["date"])
        df.set_index("date", inplace=True)
        for col in ["open", "high", "low", "close"]:
            df[col] = df[col].astype(float)

        plt.style.use("default")
        fig, ax = plt.subplots(figsize=(14, 7))

        current_price = df["close"].iloc[-1]

        ax.plot(df.index, df["close"], color="#1f2937", linewidth=1, zorder=2)

        is_correction_macro = any(
            w["label"] in ["A", "B", "C", "W", "X", "Y"] for w in waves
        )

        # 1. Standard Wellen zeichnen
        for i in range(len(waves) - 1):
            w_curr = waves[i]
            w_next = waves[i + 1]
            curr_date = pd.to_datetime(w_curr["date"])
            next_date = pd.to_datetime(w_next["date"])

            line_color = (
                "#ef4444"
                if w_next["label"] in ["A", "B", "C", "W", "X", "Y"]
                else "#2563eb"
            )
            line_style = (
                "--"
                if w_next["label"] in ["A", "B", "C", "W", "X", "Y"]
                else "-"
            )

            ax.plot(
                [curr_date, next_date],
                [w_curr["price"], w_next["price"]],
                color=line_color,
                linestyle=line_style,
                linewidth=2,
                zorder=5,
            )

            if line_style == "-" and w_next["label"] in ["1", "2", "3", "4", "5"]:
                ax.fill_between(
                    [curr_date, next_date],
                    [w_curr["price"], w_next["price"]],
                    df["low"].min() * 0.85,
                    color="#2563eb",
                    alpha=0.08,
                    zorder=1,
                )

            if i == 0:
                ax.scatter(curr_date, w_curr["price"], color="#2563eb", s=40, zorder=6)
                ax.annotate(
                    w_curr["label"],
                    (curr_date, w_curr["price"]),
                    xytext=(0, -15),
                    textcoords="offset points",
                    ha="center",
                    color="#ea580c",
                    fontweight="bold",
                    fontsize=10,
                )

            ax.scatter(next_date, w_next["price"], color=line_color, s=40, zorder=6)
            is_valley = w_next["price"] < w_curr["price"]
            ax.annotate(
                w_next["label"],
                (next_date, w_next["price"]),
                xytext=(0, -15 if is_valley else 10),
                textcoords="offset points",
                ha="center",
                color="#ea580c" if is_valley else line_color,
                fontweight="bold",
                fontsize=10,
            )

        # 2. ENGINE-LEVEL (V112.2): Cluster-Zonen & Marker der Fib-Engine.
        # Die Engine ist die Single Source of Truth fuer alle Level
        # (linear + log, Konvention steht im Label). drawer.py rechnet
        # keine eigenen Fibs mehr, wenn Cluster mitgeliefert werden.
        clusters = payload.get("clusters")
        markers = payload.get("markers", []) or []
        end_date = df.index[-1]
        last_wave_date = pd.to_datetime(waves[-1]["date"]) if waves else df.index[int(len(df) * 0.55)]
        xmin = last_wave_date if last_wave_date < end_date else df.index[int(len(df) * 0.6)]

        # Label-Kollisionsschutz: keine zwei Beschriftungen naeher als
        # 3% (log-Abstand) auf der y-Achse.
        used_label_ys = []

        def can_label(y):
            for uy in used_label_ys:
                if abs(np.log(y) - np.log(uy)) < 0.03:
                    return False
            used_label_ys.append(y)
            return True

        if clusters is not None:
            y_lo = df["low"].min() * 0.5
            y_hi = df["high"].max() * 1.1
            drawn = 0
            for cl in sorted(clusters, key=lambda c: -int(c.get("score", 1))):
                if drawn >= 6:
                    break
                floor = float(cl["floor"])
                ceiling = float(cl["ceiling"])
                score = int(cl.get("score", 1))
                if ceiling < y_lo or floor > y_hi:
                    continue
                labels = ", ".join(cl.get("labels", [])[:3])

                if score >= 2:
                    color = "#0f766e" if score >= 3 else "#b45309"
                    ax.fill_between(
                        [xmin, end_date],
                        [floor] * 2,
                        [max(ceiling, floor * 1.004)] * 2,
                        color=color,
                        alpha=min(0.10 + 0.04 * score, 0.28),
                        zorder=3,
                    )
                    ax.hlines(y=floor, xmin=xmin, xmax=end_date, colors=color,
                              linestyles="-", linewidth=1.0, zorder=4)
                    if can_label(ceiling):
                        ax.annotate(
                            f"{floor:.2f}-{ceiling:.2f} | Score {score}: {labels}",
                            (end_date, ceiling), xytext=(5, 0),
                            textcoords="offset points", color=color,
                            fontsize=8, va="center", fontweight="bold",
                        )
                else:
                    mid = (floor + ceiling) / 2.0
                    ax.hlines(y=mid, xmin=xmin, xmax=end_date, colors="#94a3b8",
                              linestyles=":", linewidth=1.0, zorder=3)
                    if can_label(mid):
                        ax.annotate(
                            f"{mid:.2f} | {labels}",
                            (end_date, mid), xytext=(5, 0),
                            textcoords="offset points", color="#64748b",
                            fontsize=7, va="center",
                        )
                drawn += 1

            for m in markers[:4]:
                price = float(m["price"])
                label = str(m.get("label", ""))
                style = "--" if label.lower().startswith("trigger") else "-."
                color = "#16a34a" if label.lower().startswith("trigger") else "#ef4444"
                ax.hlines(y=price, xmin=xmin, xmax=end_date, colors=color,
                          linestyles=style, linewidth=1.5, zorder=5)
                if can_label(price):
                    ax.annotate(
                        f"{label} ({price:.2f}$)",
                        (end_date, price), xytext=(5, 0),
                        textcoords="offset points", color=color,
                        fontsize=9, va="center", fontweight="bold",
                    )
        else:
            # Legacy-Fallback (Standalone ohne Engine-Payload):
            # kompakter Log-Golden-Pocket wie in V110.
            if len(waves) == 6 and not is_correction_macro:
                w0 = waves[0]["price"]
                w5 = waves[5]["price"]
                w5_date = pd.to_datetime(waves[5]["date"])

                if w5_date < end_date and w5 > w0:
                    log_diff = np.log(w5) - np.log(w0)
                    for f, color, ls, bold in [
                        (0.382, "#f59e0b", ":", False),
                        (0.500, "#f59e0b", ":", False),
                        (0.618, "#ef4444", "--", True),
                    ]:
                        level = np.exp(np.log(w5) - f * log_diff)
                        ax.hlines(y=level, xmin=w5_date, xmax=end_date, colors=color,
                                  linestyles=ls, linewidth=1.5, zorder=3)
                        if can_label(level):
                            ax.annotate(
                                f"logFib {f} ({level:.2f}$)",
                                (end_date, level), xytext=(5, 0),
                                textcoords="offset points", color=color, fontsize=8,
                                va="center",
                                fontweight="bold" if bold else "normal",
                            )

        ax.set_yscale("log")
        ax.grid(True, which="major", ls="-", alpha=0.2)
        ax.grid(True, which="minor", ls=":", alpha=0.1)
        title_suffix = payload.get("titleSuffix", "")
        ax.set_title(
            f"{symbol} - Self-Healing EW Master (Log-Vector Core){title_suffix}",
            loc="left", fontweight="bold", fontsize=12,
        )
        plt.subplots_adjust(right=0.92)

        buf = io.BytesIO()
        plt.savefig(buf, format="png", bbox_inches="tight", dpi=150)
        buf.seek(0)
        sys.stdout.buffer.write(buf.getvalue())

    except Exception as e:
        print(str(e), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
