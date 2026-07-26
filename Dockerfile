FROM node:20-alpine

WORKDIR /app

# 安装编译 better-sqlite3 所需的完整构建工具链
RUN apk add --no-cache build-base python3

# 先只拷贝 package.json，利用 Docker 缓存层
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev 2>/dev/null || npm install --production

COPY . .

# 创建数据目录
RUN mkdir -p /app/data

EXPOSE 3000

CMD ["node", "server.js"]
