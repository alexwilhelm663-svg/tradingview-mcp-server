# Basis-Image mit vorinstalliertem Playwright und Browser-Abhängigkeiten
FROM mcr.microsoft.com/playwright:v1.44.0-jammy

# 1. System-Abhängigkeiten aktualisieren und Python + Pip installieren
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-dev \
    && rm -rf /var/lib/apt/lists/*

# 2. Arbeitsverzeichnis im Container erstellen
WORKDIR /app

# 3. Node.js Abhängigkeiten kopieren und installieren (KORREKTUR: npm install statt npm ci)
COPY package*.json ./
RUN npm install

# 4. Python-Abhängigkeiten kopieren und über pip installieren
COPY python_service/requirements.txt ./python_service/
RUN pip3 install --no-cache-dir -r python_service/requirements.txt

# 5. Den restlichen Quellcode in den Container kopieren
COPY . .

# 6. TypeScript-Code zu JavaScript kompilieren
RUN npm run build

# 7. Sicherstellen, dass der Chromium-Browser für Playwright bereitsteht
RUN npx playwright install chromium

# Startbefehl für den Bot
CMD ["npm", "start"]
