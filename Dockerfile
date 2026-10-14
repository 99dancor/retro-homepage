FROM node:22-alpine

RUN apk add --no-cache tzdata
WORKDIR /app
ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=3000 \
    TZ=Europe/Berlin

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY views ./views
COPY public ./public

RUN mkdir -p /data && chmod 777 /data
VOLUME /data
EXPOSE 3000

HEALTHCHECK --interval=60s --timeout=5s --start-period=20s \
  CMD wget -qO- http://127.0.0.1:3000/static/favicon.svg >/dev/null || exit 1

CMD ["node", "--disable-warning=ExperimentalWarning", "src/server.js"]
