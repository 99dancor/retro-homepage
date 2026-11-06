FROM node:22-alpine

LABEL org.opencontainers.image.title="Retro-Homepage" \
      org.opencontainers.image.description="Selbst gehostete Homepage im Windows-98-Look mit Admin-Bereich"

# ImageMagick: HEIC-Fotos vom iPhone in der Galerie zu JPG umwandeln (und Vorschaubilder, falls der Browser keine schickt)
RUN apk add --no-cache tzdata imagemagick imagemagick-heic imagemagick-jpeg imagemagick-webp
WORKDIR /app
ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=3000 \
    TZ=Europe/Berlin \
    PUID=99 \
    PGID=100

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY views ./views
COPY public ./public
COPY games/haustier/src ./games/haustier/src
COPY games/fs25-export ./games/fs25-export
COPY CHANGELOG.md ./

RUN mkdir -p /data
VOLUME /data
EXPOSE 3000

HEALTHCHECK --interval=60s --timeout=5s --start-period=20s \
  CMD wget -qO- http://127.0.0.1:3000/static/favicon.svg >/dev/null || exit 1

CMD ["node", "--disable-warning=ExperimentalWarning", "src/server.js"]
