import datetime
import urllib.request
import json
import numpy as np
import matplotlib.pyplot as plt

def get_yahoo_data(symbol):
    period2 = int(datetime.datetime.now().timestamp())
    period1 = period2 - (3 * 365 * 24 * 60 * 60) # 3 Jahre Historie
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?period1={period1}&period2={period2}&interval=1d&events=history"
    
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req) as response:
        res_data = json.loads(response.read().decode())
        
    result = res_data['chart']['result'][0]
    timestamps = result['timestamp']
    quote = result['indicators']['quote'][0]
    
    raw_data = []
    for i, ts in enumerate(timestamps):
        if quote['open'][i] and quote['high'][i] and quote['low'][i] and quote['close'][i]:
            dt = datetime.datetime.fromtimestamp(ts).strftime('%Y-%m-%d')
            raw_data.append({
                "date": dt, "open": quote['open'][i], "high": quote['high'][i],
                "low": quote['low'][i], "close": quote['close'][i]
            })
    return raw_data

def aggregate_weeks(daily_candles):
    # Gruppierung der Tageskerzen in Wochenkerzen
    weeks = {}
    for c in daily_candles:
        dt = datetime.datetime.strptime(c['date'], '%Y-%m-%d')
        year, week, _ = dt.isocalendar()
        w_key = f"{year}-W{week}"
        if w_key not in weeks:
            weeks[w_key] = []
        weeks[w_key].append(c)
        
    sorted_keys = sorted(weeks.keys())
    web_candles = []
    for k in sorted_keys[-100:]: # Die letzten 100 Wochenkerzen
        c_list = weeks[k]
        web_candles.append({
            "date": c_list[-1]['date'], "open": c_list[0]['open'],
            "high: max([x['high'] for x in c_list]),
            "low": min([x['low'] for x in c_list]), "close": c_list[-1]['close']
        })
    return web_candles

def calculate_elliott_structure(candles):
    closes = np.array([c['close'] for c in candles])
    highs = np.array([c['high'] for c in candles])
    lows = np.array([c['low'] for c in candles])
    
    # Mathematische Bestimmung markanter Scheitelpunkte (Lokale Extrema)
    wave_points = []
    
    # 1. Großer Korrektur-Tiefpunkt (Makro-Welle 2 oder II)
    macro_bottom_idx = np.argmin(closes[:len(closes)//2])
    wave_points.append({"idx": macro_bottom_idx, "price": lows[macro_bottom_idx], "label": "II", "is_high": False})
    
    # 2. Erster bullischer Impuls (Sub-Welle 1)
    sub_1_idx = macro_bottom_idx + np.argmax(closes[macro_bottom_idx:macro_bottom_idx+30])
    wave_points.append({"idx": sub_1_idx, "price": highs[sub_1_idx], "label": "1", "is_high": True})
    
    # 3. Untergeordnete Korrektur (Sub-Welle 2 - Das Fundament für Third-of-Third)
    sub_2_idx = sub_1_idx + np.argmin(closes[sub_1_idx:sub_1_idx+20])
    wave_points.append({"idx": sub_2_idx, "price": lows[sub_2_idx], "label": "2", "is_high": False})
    
    # 4. Der beginnende Nestbau: Innere Mikrowellen (i) und (ii) von Welle 3
    nest_i_idx = sub_2_idx + np.argmax(closes[sub_2_idx:sub_2_idx+15])
    wave_points.append({"idx": nest_i_idx, "price": highs[nest_i_idx], "label": "(I)", "is_high": True})
    
    nest_ii_idx = nest_i_idx + np.argmin(closes[nest_i_idx:])
    wave_points.append({"idx": nest_ii_idx, "price": lows[nest_ii_idx], "label": "(II)", "is_high": False})
    
    return wave_points

def plot_chart(candles, wave_points, symbol):
    fig, ax = plt.subplots(figsize=(15, 8), facecolor='#131722')
    ax.set_facecolor('#131722')
    
    # Candlesticks zeichnen
    for i, c in enumerate(candles):
        color = '#26a69a' if c['close'] >= c['open'] else '#ef5350'
        ax.plot([i, i], [c['low'], c['high']], color=color, linewidth=1.5)
        rect = plt.Rectangle((i - 0.35, min(c['open'], c['close'])), 0.7, max(abs(c['open'] - c['close']), 0.01), facecolor=color, edgecolor=color)
        ax.add_patch(rect)
        
    # Strukturlinien und Labels einzeichnen
    x_coords = [wp['idx'] for wp in wave_points]
    y_coords = [wp['price'] for wp in wave_points]
    ax.plot(x_coords, y_coords, color='#00F0FF', linewidth=2.5, style='-', zorder=4)
    
    y_limits = ax.get_ylim()
    offset = (y_limits[1] - y_limits[0]) * 0.03
    
    for wp in wave_points:
        text_y = wp['price'] + offset if wp['is_high'] else wp['price'] - offset
        ax.text(wp['idx'], text_y, wp['label'], color='#FFFFFF', fontsize=12, fontweight='bold',
                ha='center', va='center', bbox=dict(boxstyle="round,pad=0.2", facecolor='#131722', edgecolor='#00F0FF', lw=1), zorder=5)
        
    ax.grid(True, color='#2a2e39', linestyle=':', linewidth=0.5)
    ax.tick_params(colors='#b2b5be', labelsize=10)
    plt.title(f"Deterministisches Elliott-Wellen Setup: {symbol} (Macro 1W)", color='#FFFFFF', fontsize=14)
    plt.show()

if __name__ == "__main__":
    ticker = "TEAM" # Atlassian Corporation
    print(f"🚀 Starte rein mathematischen Makro-Scan für {ticker}...")
    daily = get_yahoo_data(ticker)
    weekly = aggregate_weeks(daily)
    structure = calculate_elliott_structure(weekly)
    
    # Überprüfung auf echtes Welle 3 von 3 Setup (Welle (II) liegt über Welle 2)
    if structure[-1]['price'] > structure[2]['price'] and weekly[-1]['close'] > structure[-1]['price']:
        print("🔥 MATCH: 'Third of a Third' Nestbau mathematisch bestätigt!")
        # Kurszielprojektion (161.8% Verlängerung von Welle 1 ab Tief von Welle 2)
        w1_length = structure[1]['price'] - structure[0]['price']
        target = structure[2]['price'] + (1.618 * w1_length)
        print(f"🎯 Rechnerisches Kursziel (1.618 Extension): {target:.2f}")
    else:
        print("⚖️ Struktur konsolidiert im Makro-Rahmen. Kein explosives Setup aktiv.")
        
    plot_chart(weekly, structure, ticker)
