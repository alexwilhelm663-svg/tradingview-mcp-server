FROM mcr.microsoft.com/playwright:v1.42.1-jammy

WORKDIR /app

# Wir kopieren die package.json und tsconfig.json
COPY package*.json tsconfig.json ./

# ÄNDERUNG: 'npm install' statt 'npm ci', da im leeren Repo oft noch keine package-lock.json existiert
RUN npm install

COPY src ./src
RUN npm run build

# Installiert nur den Chromium-Browser innerhalb des Containers
RUN npx playwright install chromium

ENV NODE_ENV=production

# Startbefehl für den MCP Server
ENTRYPOINT ["node", "build/index.js"]
