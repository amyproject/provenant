# Single long-running Node host (lead decision 2026-11-07): store + signing keys live on a persistent
# volume mounted at /data, and the agent autopilot runs in-process. Run exactly ONE instance.
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx next build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data AGENT_AUTOPILOT=1 PORT=3000
COPY --from=build /app ./
VOLUME ["/data"]
EXPOSE 3000
CMD ["sh", "-c", "npx next start -p ${PORT}"]
