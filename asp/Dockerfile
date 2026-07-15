# Predikt Oracle ASP. better-sqlite3 ships prebuilt binaries for linux x64/arm64,
# so no compiler toolchain is needed in the final image.
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8787 \
    DB_PATH=/data/predikt-oracle.db
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY src ./src
COPY public ./public
RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME /data
EXPOSE 8787
# tsx is a runtime dep of the start script; keep it in dependencies or swap to
# a compiled dist + `node dist/index.js` if you prefer.
CMD ["npx", "tsx", "src/index.ts"]
