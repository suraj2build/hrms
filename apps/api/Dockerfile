FROM node:20-alpine AS base
WORKDIR /app
COPY package.json ./
RUN npm install --production=false
COPY . .
RUN npm run build

FROM node:20-alpine AS prod
WORKDIR /app
COPY package.json ./
RUN npm install --production
COPY --from=base /app/dist ./dist
EXPOSE 3001
CMD ["node", "dist/index.js"]
