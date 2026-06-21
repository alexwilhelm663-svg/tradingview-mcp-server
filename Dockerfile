# =========================================================================
# 1. BASE IMAGE
# =========================================================================
FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

# =========================================================================
# 2. SYSTEM-FUNDAMENT
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
# 3. NODE.JS ABHÄNGIGKEITEN
# =========================================================================
COPY package*.json tsconfig.json ./
RUN npm install

# =========================================================================
# 4. PYTHON QUANT ENGINE (Reine Python-Pakete!)
# =========================================================================
COPY requirements.txt* ./
RUN if [ -f requirements.txt ]; then \
        pip3 install --no-cache-dir --break-system-packages -r requirements.txt; \
    else \
        pip3 install --no-cache-dir --break-system-packages pandas matplotlib; \
    fi

# =========================================================================
# 5. BUILD & START
# =========================================================================
COPY . .

RUN npm run build

ENV PORT=10000
EXPOSE 10000

CMD ["npm", "start"]
