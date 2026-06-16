# Schlankes Basis-Image (spart extrem viel RAM im Vergleich zu Playwright)
FROM node:18-bullseye-slim

# 1. System-Abhängigkeiten für Python und Matplotlib installieren
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-dev \
    && rm -rf /var/lib/apt/lists/*

# 2. Arbeitsverzeichnis im Container erstellen
WORKDIR /app

# 3. Node.js Abhängigkeiten kopieren und installieren
COPY package*.json ./
RUN npm install

# 4. Python-Abhängigkeiten kopieren und über pip installieren
# (Ohne das Flag, da bullseye-slim eine ältere pip-Version nutzt, die es nicht benötigt)
COPY python_service/requirements.txt ./python_service/
RUN pip3 install --no-cache-dir -r python_service/requirements.txt

# 5. Den restlichen Quellcode in den Container kopieren
COPY . .

# 6. TypeScript-Code zu JavaScript kompilieren
RUN npm run build

# 7. Startbefehl für den Bot
CMD ["npm", "start"]
