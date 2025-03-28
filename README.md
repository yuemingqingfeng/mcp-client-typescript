# MCP Client TypeScript

## 概述
`MCP Client TypeScript` 是一个使用 TypeScript 编写的客户端程序，用于连接到 Model Context Protocol (MCP) 服务器，并与 DeepSeek 或 OpenAI AI 模型进行交互。该程序支持通过标准输入输出 (stdio) 或服务器发送事件 (SSE) 与服务器通信，同时可以调用服务器提供的工具。

## 功能特点
- 支持连接多个 MCP 服务器。
- 支持通过 OpenAI 或 DeepSeek 的 API 进行对话。
- 自动处理工具调用，并将工具结果反馈给 AI 模型。
- 提供交互式的聊天界面。

## 项目结构

## 环境准备
### 安装依赖
```bash
npm install

```
# 创建 .env 文件并添加以下内容：
```bash
OPENAI_API_KEY=your_openai_api_key
OPENAI_MODEL=your_openai_model
OPENAI_BASE_URL=your_openai_base_url
```

## mcp server配置文件
config.ts

## 运行项目
```bash
npm run start
```
## 交互方式

启动程序后，你可以在命令行中输入查询内容，输入 quit 退出程序。

贡献
如果你想为这个项目做出贡献，请提交 Pull Request 或创建 Issue。