FROM node:20-bookworm

# 1. Python & Matplotlib C-Core
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt* ./
RUN if [ -f requirements.txt ]; then \
        pip3 install --no-cache-dir --break-system-packages -r requirements.txt; \
    else \
        pip3 install --no-cache-dir --break-system-packages pandas matplotlib numpy; \
    fi

COPY package*.json ./

# =========================================================================
# DIE NUKLEAR-WEICHE: 
# Befehelt NPM, die Pakete stur zu saugen, selbst wenn GitHub sie löscht!
# =========================================================================
RUN npm install groq-sdk telegraf yahoo-finance2

COPY . .
RUN npm run build

ENV PORT=10000
EXPOSE 10000

CMD ["npm", "start"]
