FROM node:20-bookworm
RUN apt-get update && apt-get install -y python3 python3-pip && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt* ./
RUN pip3 install --no-cache-dir --break-system-packages pandas matplotlib numpy
COPY package*.json ./
# HIER das Gemini-SDK installieren
RUN npm install @google/generative-ai telegraf
COPY tsconfig.json ./
COPY src ./src
COPY python_service ./python_service
RUN npm run build
ENV PORT=10000
EXPOSE 10000
CMD ["npm", "start"]
