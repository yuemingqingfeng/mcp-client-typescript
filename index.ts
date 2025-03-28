import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, StdioServerParameters } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import OpenAI from "openai";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { ChatCompletionMessageParam, ChatCompletionMessageToolCall } from "openai/resources/chat/completions.js";
import { createInterface } from "readline";
import { homedir } from 'os';
import config from "./config.js";
import dotenv from "dotenv";

dotenv.config();
// 初始化环境变量
const OPENAI_API_KEY = process.env.OPENAI_API_KEY||"";
if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY environment variable is required");
}
const OPENAI_MODEL = process.env.OPENAI_MODEL||"";
if(!OPENAI_MODEL){
    throw new Error("OPENAI_MODEL environment variable is required"); 
}
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL
if(!OPENAI_BASE_URL){
    throw new Error("OPENAI_BASE_URL environment variable is required"); 
}
interface MCPToolResult {
    content: string;
}

interface CommonDto {
    flag: boolean;
    result: string;
}

interface ServerConfig {
    name: string;
    type: 'command' | 'sse';
    command?: string;
    url?: string;
    isOpen?: boolean;
}
class MCPClient {
    static getOpenServers(): string[] {
        return config.filter(cfg => cfg.isOpen).map(cfg => cfg.name);
    }
    private sessions: Map<string, Client> = new Map();
    private transports: Map<string, StdioClientTransport | SSEClientTransport> = new Map();
    private openai: OpenAI;
    constructor() {
        this.openai = new OpenAI({
            baseURL: OPENAI_BASE_URL,
            apiKey: OPENAI_API_KEY
        });
    }
    async connectToServer(serverName: string): Promise<void> {
        const serverConfig = config.find(cfg => cfg.name === serverName) as ServerConfig;
        if (!serverConfig) {
            throw new Error(`Server configuration not found for: ${serverName}`);
        }
        let transport: StdioClientTransport | SSEClientTransport;
        if (serverConfig.type === 'command' && serverConfig.command) {
            transport = await this.createCommandTransport(serverConfig.command);
        } else if (serverConfig.type === 'sse' && serverConfig.url) {
            transport = await this.createSSETransport(serverConfig.url);
        } else {
            throw new Error(`Invalid server configuration for: ${serverName}`);
        }
        const client = new Client(
            {
                name: "mcp-client",
                version: "1.0.0"
            },
            {
                capabilities: {
                    prompts: {},
                    resources: {},
                    tools: {}
                }
            }
        );
        await client.connect(transport);
        
        this.sessions.set(serverName, client);
        this.transports.set(serverName, transport);
        // 列出可用工具
        const response = await client.listTools();
        console.log(`\nConnected to server '${serverName}' with tools:`, response.tools.map((tool: Tool) => tool.name));
    }
    private async createCommandTransport(shell: string): Promise<StdioClientTransport> {
        const [command, ...shellArgs] = shell.split(' ');
        if (!command) {
            throw new Error("Invalid shell command");
        }
        // 处理参数中的波浪号路径
        const args = shellArgs.map(arg => {
            if (arg.startsWith('~/')) {
                return arg.replace('~', homedir());
            }
            return arg;
        });
        
        const serverParams: StdioServerParameters = {
            command,
            args,
            env: Object.fromEntries(
                Object.entries(process.env).filter(([_, v]) => v !== undefined)
            ) as Record<string, string>
        };
        return new StdioClientTransport(serverParams);
    }
    private async createSSETransport(url: string): Promise<SSEClientTransport> {
        return new SSEClientTransport(new URL(url));
    }
    async processQuery(query: string): Promise<string> {
        if (this.sessions.size === 0) {
            throw new Error("Not connected to any server");
        }
        const messages: ChatCompletionMessageParam[] = [
            {
                role: "user",
                content: query
            }
        ];
        // 获取所有服务器的工具列表
        const availableTools: any[] = [];
        for (const [serverName, session] of this.sessions) {
            const response = await session.listTools();
            const tools = response.tools.map((tool: Tool) => ({
                type: "function" as const,
                function: {
                    name: `${serverName}__${tool.name}`,
                    description: `[${serverName}] ${tool.description}`,
                    parameters: tool.inputSchema
                }
            }));
            availableTools.push(...tools);
        }
        // 调用OpenAI API
        const completion = await this.openai.chat.completions.create({
            model: OPENAI_MODEL,
            messages,
            tools: availableTools,
            tool_choice: "auto"
        });
        const finalText: string[] = [];
        console.log(JSON.stringify(completion, null, 2));
        // 处理OpenAI的响应
        for (const choice of completion.choices) {
            const message = choice.message;
            if (message.content) {
                finalText.push(message.content);
            }
            if (message.tool_calls) {
                for (const toolCall of message.tool_calls) {
                    let data:CommonDto = await this.useTool(toolCall);
                    console.log(JSON.stringify(data, null, 2));
                    if(data.flag){
                        finalText.push(data.result);
                        // 继续与工具结果的对话
                        // messages.push({
                        //     role: "assistant",
                        //     content: "",
                        //     tool_calls: [toolCall]
                        // });
                        // messages.push({
                        //     role: "tool",
                        //     tool_call_id: toolCall.id,
                        //     content: JSON.stringify(data.result)
                        // });
                        const newMessage: ChatCompletionMessageParam[] = [
                            {
                                role: "user",
                                content: query
                            }
                        ];
                        newMessage.push({
                            role: "user",
                            content: `请使用工具${toolCall.function.name}的结果${JSON.stringify(data.result)},组装成下一次的请求,如果不需要工具,请直接回复`
                        });
                        console.log("下次请求message:",JSON.stringify(newMessage, null, 2))
                        // 获取下一个响应
                        const nextCompletion = await this.openai.chat.completions.create({
                            model: OPENAI_MODEL,
                            'messages':newMessage,
                        });
                        const nextMessage = nextCompletion.choices[0].message;
                        console.log("下次请求:",JSON.stringify(nextMessage, null, 2))
                        if (nextMessage.content) {
                            let nextTask = await this.processQuery(nextMessage.content)
                            finalText.push(nextTask);
                        }
                    }else{
                        finalText.push(data.result);
                    }
                }
            }
        }
        return finalText.join("\n");
    }
    async useTool(toolCall:ChatCompletionMessageToolCall): Promise<any> {
        const [serverName, toolName] = toolCall.function.name.split('__');
        const commonDto: CommonDto = {
            flag: false,
            result: `${serverName}使用${toolName}工具获取数据失败`
        };
        const session = this.sessions.get(serverName);
        if (!session) {
            commonDto.result =`Error: Server ${serverName} not found]`
            return commonDto;
        }
        let toolArgs = null
        try{
            toolArgs = JSON.parse(toolCall.function.arguments);
        }catch(e){
            commonDto.result = `Error: Invalid arguments for tool ${toolName}`;
            return commonDto;
        }
        // 执行工具调用
        const result = await session.callTool({
            name: toolName,
            arguments: toolArgs
        });
        const toolResult = result as unknown as MCPToolResult;
        if (toolResult.content) {
            commonDto.flag = true;
            commonDto.result = toolResult.content;
            return commonDto; 
        }else{
            return commonDto;
        }
    }

    async chatLoop(): Promise<void> {
        console.log("\nMCP Client Started!");
        console.log("Type your queries or 'quit' to exit.");
        const readline = createInterface({
            input: process.stdin,
            output: process.stdout
        });
        const askQuestion = () => {
            return new Promise<string>((resolve) => {
                readline.question("\nQuery: ", resolve);
            });
        };
        try {
            while (true) {
                const query = (await askQuestion()).trim();
                if (query.toLowerCase() === 'quit') {
                    break;
                }
                try {
                    const response = await this.processQuery(query);
                    console.log("\n" + JSON.stringify(response));
                } catch (error) {
                    console.error("\nError:", error);
                }
            }
        } finally {
            readline.close();
        }
    }
    async cleanup(): Promise<void> {
        for (const transport of this.transports.values()) {
            await transport.close();
        }
        this.transports.clear();
        this.sessions.clear();
    }
    hasActiveSessions(): boolean {
        return this.sessions.size > 0;
    }
}
// 主函数
async function main() {
    const openServers = MCPClient.getOpenServers();
    console.log("Connecting to servers:", openServers.join(", "));
    const client = new MCPClient();
    
    try {
        // 连接所有开启的服务器
        for (const serverName of openServers) {
            try {
                await client.connectToServer(serverName);
            } catch (error) {
                console.error(`Failed to connect to server '${serverName}':`, error);
            }
        }
        if (!client.hasActiveSessions()) {
            throw new Error("Failed to connect to any server");
        }
        await client.chatLoop();
    } finally {
        await client.cleanup();
    }
}
// 运行主函数
main().catch(console.error);