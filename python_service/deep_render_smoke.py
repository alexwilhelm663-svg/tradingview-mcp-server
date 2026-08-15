#!/usr/bin/env python3
"""Offline-Smoke-Test fuer den V171-Deep-Drawer."""
import datetime as dt
import json
import math
import os
import struct
import subprocess
import sys
import tempfile
from pathlib import Path


def iso(start, weeks):
    return (start + dt.timedelta(days=7 * weeks)).isoformat().replace("+00:00", "Z")


def fixture():
    start = dt.datetime(2024, 1, 1, tzinfo=dt.timezone.utc)
    candles = []
    for index in range(100):
        base = 100 * math.exp(index * 0.005) * (1 + 0.08 * math.sin(index / 6))
        opn = base * (1 + 0.012 * math.sin(index))
        close = base * (1 + 0.012 * math.cos(index * 0.8))
        candles.append({
            "date": iso(start, index),
            "closedAt": iso(start, index + 1),
            "isClosed": True,
            "open": opn,
            "high": max(opn, close) * 1.03,
            "low": min(opn, close) * 0.97,
            "close": close,
            "volume": 1_000_000 + index * 1_000,
        })
    date = lambda index: candles[index]["date"]
    zone = {
        "floor": 142, "ceiling": 150, "center": 146,
        "score": 3, "evidenceCount": 7,
        "labels": ["Retr 0.618", "W4-Zone", "C=1.0·A"],
        "families": ["IMPULSE_RETRACEMENT", "PRIOR_WAVE", "ABC_PROJECTION"],
    }
    return {
        "version": "V171", "symbol": "SMOKE", "interval": "WEEKLY", "range": "5y",
        "price": 158, "trend": "bullish", "candles": candles, "zoomFrom": date(52),
        "waves": [
            {"label": "0", "date": date(0), "price": 100, "status": "CONFIRMED"},
            {"label": "1", "date": date(14), "price": 132, "status": "CONFIRMED"},
            {"label": "2", "date": date(27), "price": 116, "status": "CONFIRMED"},
            {"label": "3", "date": date(48), "price": 181, "status": "CONFIRMED"},
            {"label": "4", "date": date(61), "price": 148, "status": "CONFIRMED"},
            {"label": "5", "date": date(75), "price": 205, "status": "CONFIRMED"},
        ],
        "correction": [
            {"label": "A", "date": date(82), "price": 160},
            {"label": "B", "date": date(88), "price": 184},
            {"label": "C", "date": date(95), "price": 145},
        ],
        "provisional": {"date": date(99), "price": 160, "kind": "H", "label": "? Hoch"},
        "multiWave": [],
        "clusters": [{**zone, "role": "ACTIVE"}],
        "marks": [
            {"price": 166, "label": "TRIGGER · SCHLUSSKURS", "color": "#22c55e", "style": "solid"},
            {"price": 137.74, "label": "INVALIDIERUNG · SCHLUSSKURS", "color": "#ef4444", "style": "solid"},
            {"price": 200, "label": "MODELLZIEL 1.618·i", "color": "#38bdf8", "style": "dash"},
            {"price": 158, "label": "LETZTER SCHLUSS", "color": "#e2e8f0", "style": "dot"},
        ],
        "rules": [
            {"name": "PRIMÄR", "condition": "Schluss > 166,00", "result": "Ziel 200,00", "color": "#22c55e"},
            {"name": "ALTERNATIVE", "condition": "Schluss < 137,74", "result": "These invalidiert", "color": "#f97316"},
        ],
        "decision": {
            "status": "PENDING", "statusLabel": "PENDING · LEVEL EINGEFROREN",
            "direction": "LONG", "frozen": True, "zone": zone,
            "trigger": 166, "invalidation": 137.74, "cExtreme": 145,
            "target": 200, "entry": None, "potentialR": 1.2,
            "snapshotId": "0123456789abcdef", "asOf": date(95),
            "dataHash": "abcdef0123456789", "engineVersion": "171.0.0",
            "createdAt": date(95),
        },
        "evidence": {
            "countScore": "12/14", "countStability": "4/5 gleicher W0/W5-Anker",
            "continuity": "hoch · 18 % Pivot-Lücken", "quality": "5/7",
            "qualityFlags": [], "threshold": "18 %", "degree": "Primary",
            "lastConfirmedPivot": date(92), "correctionPattern": "ZIGZAG",
            "reversalRisk": "WATCH", "timeStatus": "IN_WINDOW",
            "timeWindow": {"from": date(84), "to": date(99)},
        },
        "provenance": {
            "provider": "yahoo-chart", "adjustment": "RAW_PROVIDER_OHLC",
            "fetchedAt": candles[-1]["closedAt"], "dataAsOf": candles[-1]["closedAt"],
            "dataHash": "abcdef0123456789", "corporateActionCount": 0,
            "closedBarsOnly": True,
        },
    }


def main():
    drawer = Path(__file__).with_name("deep_drawer.py")
    with tempfile.TemporaryDirectory(prefix="deep-v171-") as cache:
        env = {**os.environ, "MPLCONFIGDIR": cache}
        run = subprocess.run(
            [sys.executable, str(drawer)],
            input=json.dumps(fixture()).encode(),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=env,
            check=False,
        )
    if run.returncode != 0:
        raise RuntimeError(run.stderr.decode(errors="replace"))
    image = run.stdout
    assert image[:8] == b"\x89PNG\r\n\x1a\n", "keine PNG-Ausgabe"
    width, height = struct.unpack(">II", image[16:24])
    assert width >= 2800 and height >= 1600, (width, height)
    assert len(image) >= 100_000, len(image)
    print(f"✅ V171 Deep-Render-Smoke bestanden · {width}×{height} · {len(image)} Bytes")


if __name__ == "__main__":
    main()
