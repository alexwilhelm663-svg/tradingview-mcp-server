FROM mcr.microsoft.com/playwright:v1.42.1-jammy

WORKDIR /app

COPY package*.json tsconfig.json ./
RUN npm install

COPY src ./src
RUN npm run build

RUN npx playwright install chromium

ENV NODE_ENV=production

# Standardwerte, falls beim Starten nichts übergeben wird
ENV TICKER="BINANCE:BTCUSDT"
ENV INTERVAL="1D"

# Startet das Skript direkt
CMD ["npm", "start"]
