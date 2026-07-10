FROM node:20-alpine
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY . .

RUN addgroup -g 1001 -S eduverify \
 && adduser -S eduverify -u 1001 -G eduverify \
 && chown -R eduverify:eduverify /app

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

USER eduverify

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/api/health | grep -q '"ok":true' || exit 1

CMD ["npm", "start"]
