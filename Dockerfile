FROM node:20-bookworm

# 1. System-Abhängigkeiten für Python und Matplotlib (C-Extensions)
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

# 2. Arbeitsverzeichnis im Container festlegen
WORKDIR /app

# 3. Python-Abhängigkeiten kopieren und installieren
COPY requirements.txt* ./
RUN if [ -f requirements.txt ]; then \
        pip3 install --no-cache-dir --break-system-packages -r requirements.txt; \
    else \
        pip3 install --no-cache-dir --break-system-packages pandas matplotlib numpy; \
    fi

# 4. DER FEHLENDE HEBEL: Erst die package.json kopieren und Pakete einkaufen!
COPY package*.json ./
RUN npm install

# 5. Erst JETZT den eigentlichen Bot-Code kopieren und kompilieren
COPY . .
RUN npm run build

# 6. Cloud-Port freigeben und Triebwerk starten
ENV PORT=10000
EXPOSE 10000

CMD ["npm", "start"]
