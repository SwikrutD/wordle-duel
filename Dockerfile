FROM node:20-alpine

WORKDIR /app

COPY server/package*.json ./server/
RUN cd server && npm install --production

COPY server/ ./server/
COPY public/ ./public/

# Copy word list — edit words.txt and rebuild to add/remove words
COPY words.txt /app/words.txt

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:3000/ || exit 1

CMD ["node", "server/index.js"]
