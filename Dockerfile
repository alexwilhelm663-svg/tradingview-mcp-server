FROM node:20-bookworm

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
RUN npm install groq-sdk telegraf yahoo-finance2

# =========================================================================
# DER CHIRURGISCHE SCHUTZSCHILD: 
# Verhindert, dass Git-Leichen den node_modules Ordner überschreiben!
# =========================================================================
COPY tsconfig.json ./
COPY src ./src
COPY python_service ./python_service

RUN npm run build

ENV PORT=10000
EXPOSE 10000

CMD ["npm", "start"]
