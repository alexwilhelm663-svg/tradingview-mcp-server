FROM node:20-bookworm-slim

# Installiere Build-Tools für natives Kompilieren von better-sqlite3
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    build-essential \
    python3-dev \
    && rm -rf /var/lib/apt/lists/*

ENV VIRTUAL_ENV=/opt/venv
RUN python3 -m venv $VIRTUAL_ENV
ENV PATH="$VIRTUAL_ENV/bin:$PATH"

# Installiere Python-Dependencies
RUN pip install --no-cache-dir pandas matplotlib

WORKDIR /app

# Kopiere zuerst package.json für Caching
COPY package*.json ./

# WICHTIG: Erlaubt das Kompilieren von nativen Addons während des npm installs
RUN npm install --build-from-source

COPY . .

RUN mkdir -p /app/data
RUN npm run build

EXPOSE 10000
# Volumen für Persistenz auf Render
VOLUME ["/app/data"]

CMD ["npm", "start"]
