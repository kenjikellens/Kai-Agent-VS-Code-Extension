import * as fs from 'fs';
import { Tool, ToolContext, FunctionDeclaration, resolveSafePath } from './Tool';
import { FileToolUtils } from './FileToolUtils';
import { TurnSnapshotManager } from '../services/TurnSnapshotManager';

/**
 * Tool for writing or creating new file content within the workspace.
 */
export class WriteFileTool extends Tool {
    public readonly name = 'write_file';
    public readonly description = 'Creates a new file or completely overwrites an existing file with the specified content.';

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
                            description: 'Relative path of the target file.'
                        },
                        content: {
                            type: 'string',
                            description: 'Full string content to write.'
                        }
                    },
                    required: ['path', 'content']
                }
            }
        };
    }

    /**
     * Executes the file writing operation.
     * @param args Arguments containing the relative path and string content.
     * @param context The current execution context containing the workspace path.
     * @returns A status message indicating success.
     */
    public async execute(args: { path: string; content: string }, context: ToolContext): Promise<string> {
        const targetPath = resolveSafePath(args.path, context.workspacePath);
        const turnId = context.turnId || 'default';
        await TurnSnapshotManager.getInstance().recordBeforeMutation(turnId, targetPath);

        await FileToolUtils.ensureParentDirExists(targetPath);
        await fs.promises.writeFile(targetPath, args.content, 'utf8');
        return `Successfully wrote ${args.content.length} characters to file: ${args.path}`;
    }
}
