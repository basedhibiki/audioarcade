# Simple Dockerfile for signaling server
FROM node:18-alpine
WORKDIR /app
COPY package.json package-lock.json* .npmrc* ./
RUN npm install --production
COPY src ./src
ENV PORT=8787
EXPOSE 8787
CMD ["node", "src/index.js"]
