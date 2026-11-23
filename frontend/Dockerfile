# Stage 1: Dependencies
FROM node:20-alpine AS deps

WORKDIR /app

COPY package*.json ./
RUN npm ci

# Stage 2: Development Vite server with hot-reload
FROM deps AS dev

COPY . .

EXPOSE 5173

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "5173"]

# Stage 3: Production static bundle builder
FROM deps AS build

COPY . .
RUN npm run build

# Stage 4: Production Nginx server with COOP/COEP and API reverse proxy
FROM nginx:alpine AS prod

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
    CMD ["wget", "-qO-", "http://127.0.0.1/"]

CMD ["nginx", "-g", "daemon off;"]
