FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci --workspace @chamly/api --include-workspace-root
COPY apps/api apps/api
COPY packages/shared packages/shared
RUN npm run build:api && npm prune --omit=dev --workspace @chamly/api

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps/api/dist ./apps/api/dist
# node_modules mang theo symlink workspace trỏ tới packages/shared (không có trong image này).
# Thay bằng bản JavaScript đã biên dịch, vì API import giá trị runtime từ @chamly/shared.
RUN rm -rf node_modules/@chamly/shared \
  && mkdir -p node_modules/@chamly/shared \
  && cp -r apps/api/dist/packages/shared/src/. node_modules/@chamly/shared/ \
  && printf '{"name":"@chamly/shared","version":"0.1.0","main":"index.js"}' \
     > node_modules/@chamly/shared/package.json \
  && chown -R node:node node_modules/@chamly/shared
USER node
EXPOSE 3000
CMD ["node", "apps/api/dist/apps/api/src/main.js"]
