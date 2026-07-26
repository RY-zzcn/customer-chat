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
- 📧 **邮件通知** — 仅无人在线时发送，支持节流防骚扰
- 🔐 **管理员后台** — 密码保护，防暴力破解，支持全体举管理
- 💾 **SQLite 数据库** — 零配置，数据持久化到 `data/` 目录
- 🐳 **Docker 部署** — 一条命令启动，支持 amd64 / arm64，内建健康检查
- 🖥️ **超低资源** — 256MB 内存即可流畅运行
- 🎨 **管理后台在线配置** — 邮件、AI 开关和参数可在后台实时修改，无需重启
- 🔒 **安全增强** — 登录限流、请求体大小限制、输入校验、XSS 防护

## 🚀 快速开始

### 方式一：Docker 部署（推荐）

使用 docker-compose：

```bash
# 1. 复制并编辑环境变量
cp .env.example .env
vim .env

# 2. 启动
docker-compose up -d
```

或直接 docker run：

```bash
docker run -d \
  --name customer-chat \
  -p 3000:3000 \
  -v $(pwd)/data:/app/data \
  -e ADMIN_PASSWORD=your_password \
  ghcr.io/ry-zzcn/customer-chat:latest
```

> 💡 **邮件和 AI 配置现在可以在管理后台实时修改**，docker run 时只需设置基本密码即可。

### 方式二：直接运行

```bash
# 1. 安装依赖
npm install

# 2. 配置环境变量
cp .env.example .env
# 编辑 .env，至少填写 ADMIN_PASSWORD

# 3. 启动
npm start
```

### 访问地址

| 页面 | 地址 | 说明 |
|------|------|------|
| 顾客聊天页 | `http://localhost:3000` | 将此链接生成二维码，顾客扫码即可聊天 |
| 管理后台 | `http://localhost:3000/admin` | 密码在 `.env` 中设置 `ADMIN_PASSWORD` |

## ⚙️ 配置说明

### 环境变量（.env）

```env
# 服务端口
PORT=3000

# 管理员密码（必填！首次部署请务必修改）
ADMIN_PASSWORD=请修改此密码

# 会话密钥（部署时建议设置随机字符串，留空则自动生成）
# SESSION_SECRET=your_random_secret_here

# 数据持久化目录（Docker 部署自动设为 /app/data）
# DATA_DIR=./data
```

### 邮件和 AI 配置（管理后台）

部署后登录管理后台 → **设置** 标签页，即可在线配置：

| 配置项 | 说明 |
|--------|------|
| 📧 邮件通知 | SMTP 服务器、端口、加密方式、邮箱/授权码、通知邮箱、启停开关、测试邮件 |
| 🤖 AI 机器人 | 平台名称、模型名称、API 地址、API Key、启停开关 |

修改后**即时生效**，不需要重启服务。

> **QQ 邮箱 SMTP 授权码获取**：QQ邮箱 → 设置 → 账户 → POP3/SMTP服务 → 开启 → 生成授权码

## 📸 功能说明

### 顾客端
- 首次访问可填写昵称或匿名开始聊天
- 断开连接时显示重连提示、输入框自动禁用
- 管理员在线/离线状态实时显示
- 支持快捷问题、自动保存会话

### 管理员后台
- 左侧会话列表，实时显示未读数，支持搜索筛选
- 聊天区实时回复，支持加载更多历史消息
- 管理员上/下线时自动通知所有访客
- 知识库管理（关键词 + 回复）
- 在线修改系统设置、邮件配置、AI 配置

## 🏗️ 项目结构

```
customer-chat/
├── server.js              # 主服务端 (Express + Socket.IO)
├── database.js            # SQLite 数据库模块
├── mailer.js              # 邮件通知模块（支持热重载）
├── knowledge.js           # 知识库关键词自动回复
├── ai.js                  # AI 机器人模块 (DeepSeek/OpenAI，支持热重载)
├── package.json           # 依赖配置
├── package-lock.json      # 依赖锁定文件
├── Dockerfile             # Docker 镜像构建（含 HEALTHCHECK）
├── docker-compose.yml     # Docker Compose 编排（含 healthcheck）
├── .env.example           # 环境变量配置模板（仅系统级配置）
├── data/                  # 数据目录（chat.db + sessions.db + .session_secret）
├── public/
│   └── index.html          # 顾客端聊天页面
└── admin/
    ├── login.html          # 管理员登录页
    └── index.html          # 管理后台
```

## 🔧 技术栈

| 层面 | 技术 |
|------|------|
| 后端 | Node.js >= 18 + Express |
| 实时通信 | Socket.IO (WebSocket) |
| 数据库 | SQLite (better-sqlite3) |
| 邮件 | Nodemailer（支持热重载） |
| 限流 | express-rate-limit |
| 前端 | 原生 HTML/CSS/JS |
| AI（可选） | DeepSeek / OpenAI API（支持热重载） |
| 部署 | Docker / Docker Compose |

## 🔒 安全特性

- 登录频率限制（15 分钟内最多 10 次）
- 请求体大小限制（1MB）
- 消息内容 HTML 转义（防 XSS）
- 密码 bcrypt 哈希存储
- 会话密钥持久化（重启不影响登录态）
- 全局未捕获异常处理
- 优雅关闭（SIGTERM/SIGINT）

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
