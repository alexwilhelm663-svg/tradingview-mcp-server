# =========================================================================
# 1. BASE IMAGE (Topmodernes Debian 12 Bookworm + Node 22 Slim)
# =========================================================================
FROM node:22-bookworm-slim

# Verhindert interaktive Debian-Rückfragen während des CI-Builds
ENV DEBIAN_FRONTEND=noninteractive

# =========================================================================
# 2. SYSTEM-FUNDAMENT & PYTHON 3.11 INSTALLATION
# =========================================================================
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-dev \
    build-essential \
    pkg-config \
    libfreetype6-dev \
    libpng-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# =========================================================================
# 3. NODE.JS ABHÄNGIGKEITEN (Pfeilschneller Cache-Layer)
# =========================================================================
COPY package*.json tsconfig.json ./
RUN npm ci

# =========================================================================
# 4. PYTHON QUANT ENGINE INSTALLATION (Mit legalem PEP 668 Override)
# =========================================================================
# Falls du eine requirements.txt hast, nutzt er sie – ansonsten Fallback auf Direkt-Pip
COPY requirements.txt* ./
RUN if [ -f requirements.txt ]; then \
        pip3 install --no-cache-dir --break-system-packages -r requirements.txt; \
    else \
        pip3 install --no-cache-dir --break-system-packages pandas matplotlib yahoo-finance2; \
    fi

# =========================================================================
# 5. SOURCE CODE BUILD & START
# =========================================================================
COPY . .

# Kompiliert den TypeScript-Code zu JavaScript (dist/)
RUN npm run build

# Port-Freigabe für die Render-Cloud oder lokale Aufrufe
ENV PORT=10000
EXPOSE 10000

# Startet den MCP-Server / Telegram-Bot
CMD ["npm", "start"]
