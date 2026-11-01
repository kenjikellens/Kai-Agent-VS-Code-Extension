import * as path from 'path';
import * as fs from 'fs';
import { Tool, ToolContext, FunctionDeclaration } from './Tool';
import { McpProcessBridge } from './McpProcessBridge';

/**
 * Arguments supported by the WebSearchTool.
 */
export interface WebSearchArgs {
    /** Search query to execute on the web. */
    query: string;
    /** Optional number of results to fetch (1-10, default 5). */
    limit?: number;
    /** Whether to fetch full page content (default true). */
    includeContent?: boolean;
}

/**
 * Autonomous tool for performing real-time web searches and webpage extractions
 * by communicating with the bundled Web Search MCP server.
 */
export class WebSearchTool extends Tool {
    public readonly name = 'web_search';
    public readonly description = 'Searches the web and extracts full page content from top results for real-time information, documentation, and live data.';
    protected readonly maxOutputLines = 80;
    protected readonly maxOutputBytes = 8000;

    /**
     * Returns the OpenAI-compatible function declaration schema for web search.
     */
    public getFunctionDeclaration(): FunctionDeclaration {
        return {
            type: 'function',
            function: {
                name: this.name,
                description: this.description,
                parameters: {
                    type: 'object',
                    properties: {
                        query: {
                            type: 'string',
                            description: 'The search query or research topic to search on the web.'
                        },
                        limit: {
                            type: 'number',
                            description: 'Number of top search results to return (1-10, default 5).'
                        },
                        includeContent: {
                            type: 'boolean',
                            description: 'Whether to extract full webpage content from results (default: true).'
                        }
                    },
                    required: ['query']
                }
            }
        };
    }

    /**
     * Executes the web search tool via the MCP process bridge.
     * @param args Arguments containing search query, limit, and includeContent flag.
     * @param context Execution context containing workspace and extension paths.
     * @returns A promise resolving to the search results string.
     */
    public async execute(args: WebSearchArgs, context: ToolContext): Promise<string> {
        if (!args || !args.query || typeof args.query !== 'string' || !args.query.trim()) {
            return 'Error: Missing required parameter "query". Please provide a valid search query.';
        }

        const serverScriptPath = this.resolveMcpServerPath(context);
        if (!serverScriptPath) {
            return 'Error: Web Search MCP server script could not be located. Ensure web-search-mcp folder is present in the repository or configure "kai.webSearchMcpPath".';
        }

        const limit = typeof args.limit === 'number' && args.limit >= 1 && args.limit <= 10 ? args.limit : 5;
        const includeContent = args.includeContent !== undefined ? Boolean(args.includeContent) : true;
        const toolName = includeContent ? 'full-web-search' : 'get-web-search-summaries';

        try {
            const rawResult = await McpProcessBridge.callTool({
                serverScriptPath,
                toolName,
                arguments: {
                    query: args.query.trim(),
                    limit,
                    includeContent
                },
                timeoutMs: 40000
            });

            return this.truncateOutput(rawResult);
        } catch (err: any) {
            return `[Web Search MCP Error]: ${err.message || err}`;
        }
    }

    /**
     * Resolves the relative path to the web-search-mcp server script across different environments.
     * Evaluates candidates relative to host configuration, extension path, and workspace directory.
     * @param context The execution context.
     * @returns The resolved absolute path if found, or null otherwise.
     */
    public resolveMcpServerPath(context: ToolContext): string | null {
        // 1. Check user-configured custom path from host services
        if (context.hostServices) {
            try {
                const customPath = context.hostServices.getConfiguration<string>('kai', 'webSearchMcpPath');
                if (customPath && customPath.trim()) {
                    const resolved = path.isAbsolute(customPath)
                        ? customPath
                        : path.resolve(context.workspacePath, customPath);
                    if (fs.existsSync(resolved)) {
                        return resolved;
                    }
                }
            } catch {
                // Ignore configuration lookup failures
            }
        }

        // 2. Candidate relative paths to check dynamically
        const candidates: string[] = [
            path.resolve(__dirname, '../../web-search-mcp-v0.3.2/dist/index.js'),
            path.resolve(__dirname, '../../../web-search-mcp-v0.3.2/dist/index.js'),
            path.resolve(__dirname, '../web-search-mcp-v0.3.2/dist/index.js'),
            path.resolve(context.workspacePath, 'web-search-mcp-v0.3.2/dist/index.js'),
            path.resolve(context.workspacePath, '../web-search-mcp-v0.3.2/dist/index.js'),
            path.resolve(context.workspacePath, 'web-search-mcp/dist/index.js'),
            path.resolve(context.workspacePath, '../web-search-mcp/dist/index.js'),
            path.resolve(process.cwd(), 'web-search-mcp-v0.3.2/dist/index.js')
        ];

        // If extensionPath is provided in context, add candidates relative to it
        if (context.extensionPath) {
            candidates.push(
                path.resolve(context.extensionPath, '../web-search-mcp-v0.3.2/dist/index.js'),
                path.resolve(context.extensionPath, 'web-search-mcp-v0.3.2/dist/index.js'),
                path.resolve(context.extensionPath, '../../web-search-mcp-v0.3.2/dist/index.js')
            );
        }

        for (const candidate of candidates) {
            if (fs.existsSync(candidate)) {
                return candidate;
            }
        }

        return null;
    }
}
