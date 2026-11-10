# Runs the prebuilt release as-is (no build step on the server).
FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3000 BIND_ADDRESS=0.0.0.0
COPY . .
RUN mkdir -p data/uploads && chown -R node:node data
USER node
EXPOSE 3000
CMD ["sh", "-c", "node tools/migrate.mjs && HOSTNAME=0.0.0.0 exec node server.js"]
