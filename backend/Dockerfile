FROM node:20-alpine

WORKDIR /app/backend

COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev

COPY backend ./

ENV NODE_ENV=production

EXPOSE 8787

CMD ["npm", "run", "start"]
