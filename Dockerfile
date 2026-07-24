FROM node:18-alpine

WORKDIR /app

COPY . .
RUN mkdir -p /app/server-data

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=80

EXPOSE 80

CMD ["node", "server.js"]
