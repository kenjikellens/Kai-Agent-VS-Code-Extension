import * as path from 'path';
import * as fs from 'fs';
import { Tool, ToolContext, FunctionDeclaration } from './Tool';

/**
 * Tool for searching code symbols (classes, functions, interfaces, methods) across workspace files.
 */
export class SymbolSearchTool extends Tool {
    public readonly name = 'symbol_search';
    public readonly description = 'Searches for AST symbols (classes, functions, methods, interfaces) across the workspace.';
    protected readonly maxOutputLines = 100;
    protected readonly maxOutputBytes = 6000;

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
                            description: 'Name or partial name of the symbol to search for.'
                        }
                    },
                    required: ['query']
                }
            }
        };
    }

    /**
     * Executes symbol search via host services (VS Code language provider) with fast regex AST fallback.
     * @param args Symbol query parameter.
     * @param context Workspace context.
     * @returns Formatted symbol location list.
     */
    public async execute(args: { query: string }, context: ToolContext): Promise<string> {
        if (!args.query || !args.query.trim()) {
            return 'Error: Symbol search query cannot be empty.';
        }

        // 1. Try host services provider (VS Code language services)
        if (context.hostServices) {
            try {
                const hostResult = await context.hostServices.searchWorkspaceSymbols(args.query, context.workspacePath);
                if (hostResult && !hostResult.startsWith('Failed to execute')) {
                    return this.truncateOutput(hostResult);
                }
            } catch {
                // Fall back to local regex scanner
            }
        }

        // 2. Standalone fallback regex scanner
        const results: string[] = [];
        const pattern = new RegExp(`\\b(class|function|interface|type|enum|const|let|var|def)\\s+(${args.query}\\w*)\\b`, 'i');

        const scanDir = (dir: string) => {
            if (results.length >= 50) return;
            try {
                const entries = fs.readdirSync(dir, { withFileTypes: true });
                for (const entry of entries) {
                    if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'build') {
                        continue;
                    }
                    const fullPath = path.join(dir, entry.name);
                    if (entry.isDirectory()) {
                        scanDir(fullPath);
                    } else if (entry.isFile() && /\.(js|ts|jsx|tsx|py|java|cpp|c|rs|go|php|rb|cs|html|css)$/i.test(entry.name)) {
                        try {
                            const content = fs.readFileSync(fullPath, 'utf8');
                            const lines = content.split(/\r?\n/);
                            for (let i = 0; i < lines.length; i++) {
                                const line = lines[i];
                                const match = line.match(pattern);
                                if (match) {
                                    const kind = match[1];
                                    const symbolName = match[2];
                                    const relPath = path.relative(context.workspacePath, fullPath).replace(/\\/g, '/');
                                    results.push(`[${kind.toUpperCase()}] ${symbolName} -> ${relPath}:${i + 1}`);
                                    if (results.length >= 50) break;
                                }
                            }
                        } catch {
                            // Ignore unreadable file
                        }
                    }
                }
            } catch {
                // Ignore unreadable dir
            }
        };

        scanDir(context.workspacePath);

        if (results.length === 0) {
            return `No symbols found matching query: "${args.query}"`;
        }

        return this.truncateOutput(results.join('\n'));
    }
}
