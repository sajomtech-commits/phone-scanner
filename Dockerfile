# Phone Scanner — image de production
FROM node:24-slim

# curl-impersonate : empreinte TLS Chrome, requise pour interroger Leboncoin
# (protégé par DataDome) sans navigateur.
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && curl -fsSL https://github.com/lexiforest/curl-impersonate/releases/download/v1.3.1/curl-impersonate-v1.3.1.x86_64-linux-gnu.tar.gz \
   | tar xz -C /usr/local/bin curl-impersonate curl_chrome131 \
 && chmod +x /usr/local/bin/curl-impersonate /usr/local/bin/curl_chrome131

WORKDIR /app
COPY package.json server.js ./
COPY lib ./lib
COPY public ./public

ENV NODE_ENV=production \
    PORT=3210 \
    DATA_DIR=/data \
    LBC_CURL=/usr/local/bin/curl_chrome131

VOLUME /data
EXPOSE 3210

CMD ["node", "server.js"]
