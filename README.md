<p align="center">
  <h1 align="center">💬 Customer Chat</h1>
  <p align="center">轻量级开源在线客服聊天系统</p>
  <p align="center">
    <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License">
    <img src="https://img.shields.io/badge/node-%3E%3D18-green.svg" alt="Node">
    <img src="https://img.shields.io/badge/docker-supported-brightgreen.svg" alt="Docker">
  </p>
</p>

---

## ✨ 功能特性

- 🔴 **实时聊天** — 基于 WebSocket（Socket.IO），毫秒级双向通信
- 📚 **知识库** — 关键词匹配自动回复，可自定义问答对
- 🤖 **AI 机器人** — 可选接入 DeepSeek / OpenAI API，无人值守时自动应答
- 📧 **邮件通知** — 访客发送消息后自动邮件提醒管理员
- 🔐 **管理员后台** — 密码保护，支持会话管理、查看/回复消息
- 💾 **SQLite 数据库** — 零配置，数据一个文件搞定
- 🐳 **Docker 部署** — 一条命令启动，支持 amd64 / arm64
- 🖥️ **超低资源** — 256MB 内存即可流畅运行
- 🌐 **全中文界面** — 顾客端和管理后台均为中文

## 🚀 快速开始

### 方式一：Docker 部署（推荐）

```bash
# 使用 GitHub 镜像
docker run -d \
  --name customer-chat \
  -p 3000:3000 \
  -v $(pwd)/data:/app/data \
  -e SMTP_HOST=smtp.qq.com \
  -e SMTP_PORT=465 \
  -e SMTP_SECURE=true \
  -e SMTP_USER=your_email@qq.com \
  -e SMTP_PASS=your_smtp_code \
  -e NOTIFY_EMAIL=your_email@qq.com \
  -e ADMIN_PASSWORD=your_password \
  ghcr.io/ry-zzcn/customer-chat:latest
```

或使用 docker-compose：

```bash
# 1. 复制并编辑环境变量
cp .env.example .env
vim .env

# 2. 启动
docker-compose up -d
```

### 方式二：直接运行

```bash
# 1. 克隆仓库
git clone https://github.com/RY-zzcn/customer-chat.git
cd customer-chat

# 2. 安装依赖
npm install

# 3. 配置环境变量
cp .env.example .env
# 编辑 .env 填写邮箱等信息

# 4. 启动
npm start
```

### 访问地址

| 页面 | 地址 | 说明 |
|------|------|------|
| 顾客聊天页 | `http://localhost:3000` | 将此链接生成二维码，顾客扫码即可聊天 |
| 管理后台 | `http://localhost:3000/admin` | 默认密码 `admin123`，登录后请立即修改 |

## ⚙️ 配置说明

编辑 `.env` 文件：

```env
# 服务端口
PORT=3000

# 管理员密码（首次启动后请立即修改）
ADMIN_PASSWORD=admin123

# 邮件通知配置（以 QQ 邮箱为例）
SMTP_HOST=smtp.qq.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=your_email@qq.com
SMTP_PASS=your_smtp_authorization_code
NOTIFY_EMAIL=your_email@qq.com

# AI 机器人配置（可选，推荐 DeepSeek，国内访问快且便宜）
AI_ENABLED=false
AI_PROVIDER=deepseek
AI_API_KEY=your_api_key_here
AI_API_URL=https://api.deepseek.com/v1/chat/completions
AI_MODEL=deepseek-chat
```

> **QQ 邮箱 SMTP 授权码获取**：QQ邮箱 → 设置 → 账户 → POP3/SMTP服务 → 开启 → 生成授权码

## 📸 截图预览

### 顾客端聊天页面
<div align="center">
  <img src="https://img.shields.io/badge/界面-全中文-blue" alt="Chinese UI">
</div>

- 聊天式界面，支持快捷问题
- 自动保存会话，刷新不丢失
- 知识库 / AI 自动回复

### 管理员后台
- 左侧会话列表，实时显示未读数
- 聊天区实时回复
- 知识库管理（关键词 + 回复）
- 系统设置（修改密码、邮件测试、AI 状态）

## 🏗️ 项目结构

```
customer-chat/
├── server.js              # 主服务端 (Express + Socket.IO)
├── database.js            # SQLite 数据库模块
├── mailer.js              # 邮件通知模块
├── knowledge.js           # 知识库关键词自动回复
├── ai.js                  # AI 机器人模块 (DeepSeek/OpenAI)
├── package.json           # 依赖配置
├── Dockerfile             # Docker 镜像构建
├── docker-compose.yml     # Docker Compose 编排
├── .env.example           # 环境变量配置模板
├── .github/workflows/      # CI/CD 自动构建
│   ├── release.yml         #   版本自动发布
│   └── docker-build.yml    #   Docker 镜像自动构建
├── public/
│   └── index.html          # 顾客端聊天页面
└── admin/
    ├── login.html          # 管理员登录页
    └── index.html          # 管理后台
```

## 🔧 技术栈

| 层面 | 技术 |
|------|------|
| 后端 | Node.js + Express |
| 实时通信 | Socket.IO (WebSocket) |
| 数据库 | SQLite (better-sqlite3) |
| 邮件 | Nodemailer |
| 前端 | 原生 HTML/CSS/JS |
| AI（可选） | DeepSeek / OpenAI API |
| 部署 | Docker / Docker Compose |

## 📦 Docker 镜像

每次推送到 `main` 分支或创建版本标签时，GitHub Actions 会自动构建 Docker 镜像并推送到 GitHub Container Registry。

```bash
# 拉取最新镜像
docker pull ghcr.io/ry-zzcn/customer-chat:latest

# 拉取指定版本
docker pull ghcr.io/ry-zzcn/customer-chat:v1.0.0
```

## 🔖 版本发布

创建 Git 标签即可自动发布版本：

```bash
git tag v1.0.0
git push origin v1.0.0
```

GitHub Actions 会自动：
1. 生成 Release Notes
2. 创建 GitHub Release
3. 构建多架构 Docker 镜像到 GitHub Packages

## 📄 License

MIT © [RY-zzcn](https://github.com/RY-zzcn)
