FROM node:20-alpine

WORKDIR /app

# 安装编译 better-sqlite3 所需的依赖
RUN apk add --no-cache python3 make g++

COPY package.json ./
RUN npm install --production

COPY . .

EXPOSE 3000

CMD ["node", "server.js"]
