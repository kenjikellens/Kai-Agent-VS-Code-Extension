import * as path from 'path';
import * as fs from 'fs';
import { Tool, ToolContext, FunctionDeclaration } from './Tool';

/**
 * Tool for retrieving diagnostics, compiler errors, and linter warnings across the workspace.
 */
export class GetDiagnosticsTool extends Tool {
    public readonly name = 'get_diagnostics';
    public readonly description = 'Retrieves workspace diagnostics, syntax errors, and file status.';

    public getFunctionDeclaration(): FunctionDeclaration {
        return {
            type: 'function',
            function: {
                name: this.name,
                description: this.description,
                parameters: {
                    type: 'object',
                    properties: {
                        path: {
                            type: 'string',
                            description: 'Optional relative path to check diagnostics for a specific file.'
                        }
                    }
                }
            }
        };
    }

    /**
     * Executes diagnostics retrieval via host services or standalone fallback.
     * @param args Optional path filter.
     * @param context Active tool execution context.
     * @returns Formatted diagnostics summary.
     */
    public async execute(args: { path?: string }, context: ToolContext): Promise<string> {
        if (context.hostServices) {
            const targetPath = args.path
                ? (path.isAbsolute(args.path) ? args.path : path.join(context.workspacePath, args.path))
                : undefined;
            return await context.hostServices.getDiagnostics(targetPath);
        }

        if (args.path) {
            const targetPath = path.isAbsolute(args.path) ? args.path : path.join(context.workspacePath, args.path);
            if (!fs.existsSync(targetPath)) {
                return `File does not exist: ${args.path}`;
            }
            if (args.path.endsWith('.json')) {
                try {
                    const content = fs.readFileSync(targetPath, 'utf8');
                    JSON.parse(content);
                    return 'No syntax errors detected.';
                } catch (e: any) {
                    return `[ERROR] ${args.path}: Invalid JSON syntax - ${e.message}`;
                }
            }
        }
        return 'No diagnostics found in workspace.';
    }
}
