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

        if not candles or not waves:
            sys.exit(1)

        df = pd.DataFrame(candles)
        df["date"] = pd.to_datetime(df["date"])
        df.set_index("date", inplace=True)
        for col in ["open", "high", "low", "close"]:
            df[col] = df[col].astype(float)

        plt.style.use("default")
        fig, ax = plt.subplots(figsize=(14, 7))

        # Aktueller Kurs für dynamische Sensorik
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

            if line_style == "-" and w_next["label"] in [
                "1",
                "2",
                "3",
                "4",
                "5",
            ]:
                ax.fill_between(
                    [curr_date, next_date],
                    [w_curr["price"], w_next["price"]],
                    df["low"].min() * 0.85,
                    color="#2563eb",
                    alpha=0.08,
                    zorder=1,
                )

            if i == 0:
                ax.scatter(
                    curr_date, w_curr["price"], color="#2563eb", s=40, zorder=6
                )
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

            ax.scatter(
                next_date, w_next["price"], color=line_color, s=40, zorder=6
            )
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

        # =====================================================================
        # 🔥 2. LOGARITHMIC TARGET MATRIX (Bullen-Impuls)
        # =====================================================================
        if len(waves) == 6 and not is_correction_macro:
            w0 = waves[0]["price"]
            w4 = waves[4]["price"]
            w5 = waves[5]["price"]
            w5_date = pd.to_datetime(waves[5]["date"])
            end_date = df.index[-1]

            if w5_date < end_date and w5 > w0:
                log_w0 = np.log(w0)
                log_w5 = np.log(w5)
                log_diff = log_w5 - log_w0

                # Logarithmische Retracements (Prozentual korrekte Schwingung)
                f382 = np.exp(log_w5 - (0.382 * log_diff))
                f500 = np.exp(log_w5 - (0.500 * log_diff))
                f618 = np.exp(log_w5 - (0.618 * log_diff))

                ax.hlines(
                    y=f382,
                    xmin=w5_date,
                    xmax=end_date,
                    colors="#f59e0b",
                    linestyles=":",
                    linewidth=1.5,
                    zorder=3,
                )
                ax.annotate(
                    f"Fib 0.382 ({f382:.2f}$)",
                    (end_date, f382),
                    xytext=(5, 0),
                    textcoords="offset points",
                    color="#f59e0b",
                    fontsize=8,
                    va="center",
                )

                ax.hlines(
                    y=f500,
                    xmin=w5_date,
                    xmax=end_date,
                    colors="#f59e0b",
                    linestyles=":",
                    linewidth=1.5,
                    zorder=3,
                )
                ax.annotate(
                    f"Fib 0.500 ({f500:.2f}$)",
                    (end_date, f500),
                    xytext=(5, 0),
                    textcoords="offset points",
                    color="#f59e0b",
                    fontsize=8,
                    va="center",
                )

                ax.hlines(
                    y=f618,
                    xmin=w5_date,
                    xmax=end_date,
                    colors="#ef4444",
                    linestyles="--",
                    linewidth=1.5,
                    zorder=3,
                )
                ax.annotate(
                    f"Fib 0.618 Golden Pocket ({f618:.2f}$)",
                    (end_date, f618),
                    xytext=(5, 0),
                    textcoords="offset points",
                    color="#ef4444",
                    fontsize=8,
                    va="center",
                    fontweight="bold",
                )

                ax.fill_between(
                    [w5_date, end_date],
                    [w4] * 2,
                    [f618] * 2,
                    color="#ef4444",
                    alpha=0.05,
                    zorder=1,
                )

        # =====================================================================
        # 🔥 3. LOGARITHMIC CORRECTION PROJECTION (V103 - Vektor-Geometrie)
        # =====================================================================
        node_A = next((w for w in waves if w["label"] == "A"), None)
        node_B = next((w for w in waves if w["label"] == "B"), None)

        if node_A and node_B:
            idx_A = waves.index(node_A)
            if idx_A > 0:
                p_start_A = waves[idx_A - 1]["price"]
                p_A = node_A["price"]
                p_B = node_B["price"]

                if p_start_A > p_A:
                    log_start_A = np.log(p_start_A)
                    log_A = np.log(p_A)
                    log_B = np.log(p_B)

                    # Logarithmische Vektor-Länge der Welle A
                    log_drop_A = log_start_A - log_A

                    # Die 3 echten, prozentualen Projektionsziele für Welle C
                    t_618 = np.exp(log_B - (0.618 * log_drop_A))
                    t_100 = np.exp(log_B - (1.000 * log_drop_A))
                    t_1618 = np.exp(log_B - (1.618 * log_drop_A))

                    date_B = pd.to_datetime(node_B["date"])
                    end_date = df.index[-1]

                    if date_B <= end_date:
                        # Minimal-Ziel (0.618)
                        ax.hlines(
                            y=t_618,
                            xmin=date_B,
                            xmax=end_date,
                            colors="#c084fc",
                            linestyles=":",
                            linewidth=1.2,
                            zorder=4,
                        )
                        ax.annotate(
                            f"C = 0.618 A ({t_618:.2f}$)",
                            (end_date, t_618),
                            xytext=(5, 0),
                            textcoords="offset points",
                            color="#c084fc",
                            fontsize=8,
                            va="center",
                        )

                        # Dynamische Sensorik für das 1.000er Hauptziel
                        if current_price < t_100:
                            # Ziel wurde nach unten durchbrochen -> Wird zu Widerstand!
                            ax.hlines(
                                y=t_100,
                                xmin=date_B,
                                xmax=end_date,
                                colors="#ef4444",
                                linestyles="--",
                                linewidth=1.2,
                                zorder=4,
                            )
                            ax.annotate(
                                f"C = 1.000 A ({t_100:.2f}$) [Broken / Resistance]",
                                (end_date, t_100),
                                xytext=(5, 0),
                                textcoords="offset points",
                                color="#ef4444",
                                fontsize=8,
                                va="center",
                            )

                            # 1.618 wird zum neuen Hauptziel deklariert
                            ax.hlines(
                                y=t_1618,
                                xmin=date_B,
                                xmax=end_date,
                                colors="#9f1239",
                                linestyles="-.",
                                linewidth=1.8,
                                zorder=4,
                            )
                            ax.annotate(
                                f"C = 1.618 A ({t_1618:.2f}$) [Capitulation Target]",
                                (end_date, t_1618),
                                xytext=(5, 0),
                                textcoords="offset points",
                                color="#9f1239",
                                fontsize=9,
                                va="center",
                                fontweight="bold",
                            )
                            ax.fill_between(
                                [date_B, end_date],
                                [t_100] * 2,
                                [t_1618] * 2,
                                color="#9f1239",
                                alpha=0.04,
                                zorder=1,
                            )
                        else:
                            # Normalzustand: 1.000 ist das aktive Ziel
                            ax.hlines(
                                y=t_100,
                                xmin=date_B,
                                xmax=end_date,
                                colors="#ec4899",
                                linestyles="--",
                                linewidth=1.6,
                                zorder=4,
                            )
                            ax.annotate(
                                f"C = 1.000 A ({t_100:.2f}$) [Target]",
                                (end_date, t_100),
                                xytext=(5, 0),
                                textcoords="offset points",
                                color="#ec4899",
                                fontsize=9,
                                va="center",
                                fontweight="bold",
                            )

                            ax.hlines(
                                y=t_1618,
                                xmin=date_B,
                                xmax=end_date,
                                colors="#9f1239",
                                linestyles="-.",
                                linewidth=1.0,
                                zorder=4,
                            )
                            ax.annotate(
                                f"C = 1.618 A ({t_1618:.2f}$)",
                                (end_date, t_1618),
                                xytext=(5, 0),
                                textcoords="offset points",
                                color="#9f1239",
                                fontsize=8,
                                va="center",
                            )

        ax.set_yscale("log")
        ax.grid(True, which="major", ls="-", alpha=0.2)
        ax.grid(True, which="minor", ls=":", alpha=0.1)
        ax.set_title(
            f"{symbol} - Self-Healing EW Master (Log-Vector Core)",
            loc="left",
            fontweight="bold",
            fontsize=12,
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
    
