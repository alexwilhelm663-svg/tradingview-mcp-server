FROM mcr.microsoft.com/playwright:v1.42.1-jammy

WORKDIR /app

COPY package*.json tsconfig.json ./
RUN npm ci

COPY src ./src
RUN npm run build

# Installiert nur den Chromium-Browser innerhalb des Containers
RUN npx playwright install chromium

ENV NODE_ENV=production

# Da MCP über stdin/stdout kommuniziert, starten wir es direkt
ENTRYPOINT ["node", "build/index.js"]

