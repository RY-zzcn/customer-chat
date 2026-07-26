FROM node:20-alpine

WORKDIR /app

# sql.js 是纯 JS 实现，无需编译工具，轻量快速
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev 2>/dev/null || npm install --production

COPY . .

# 创建数据目录
RUN mkdir -p /app/data

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=10s \
  CMD node -e "require('http').get('http://localhost:3000/api/health', r => {process.exit(r.statusCode===200?0:1)})"

CMD ["node", "server.js"]
