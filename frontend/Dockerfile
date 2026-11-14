FROM node:24-alpine AS build
WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/index.html frontend/tsconfig.json ./
COPY frontend/src src
RUN npm run build
FROM nginx:alpine
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
COPY docs/integrations/asyncapi.yaml docs/api/*.json nexora/contracts/* /usr/share/nginx/html/contracts/
