import * as fs from 'fs';
import { Tool, ToolContext, FunctionDeclaration, resolveSafePath } from './Tool';
import { TurnSnapshotManager } from '../services/TurnSnapshotManager';

/**
 * Tool for deleting files or directories within the workspace.
 * Supports deleting a single item via `path` or multiple items via `paths`.
 */
export class DeleteItemTool extends Tool {
    public readonly name = 'delete_item';
    public readonly description = 'Deletes one or multiple files or directories (and their contents) within the workspace.';

    /**
     * Generates the OpenAI function declaration schema for delete_item.
     * @returns The function schema.
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
                        path: {
                            type: 'string',
                            description: 'Relative path of a single target file or folder to delete.'
                        },
                        paths: {
                            type: 'array',
                            items: {
                                type: 'string'
                            },
                            description: 'Array of relative paths of files or folders to delete.'
                        }
                    }
                }
            }
        };
    }

    /**
     * Executes deletion for single or multiple files/folders.
     * @param args Arguments containing relative path or list of paths to delete.
     * @param context The execution context containing workspace details.
     * @returns Status message detailing success or failure for each item.
     */
    public async execute(args: { path?: string | string[]; paths?: string[] }, context: ToolContext): Promise<string> {
        let targets: string[] = [];

        if (Array.isArray(args.paths)) {
            targets = args.paths;
        } else if (Array.isArray(args.path)) {
            targets = args.path;
        } else if (typeof args.path === 'string' && args.path.trim()) {
            targets = [args.path.trim()];
        } else if (typeof args.paths === 'string' && (args.paths as string).trim()) {
            targets = [(args.paths as string).trim()];
        }

        if (targets.length === 0) {
            return 'Error: Either path or paths argument must be provided for delete_item.';
        }

        const deleted: string[] = [];
        const errors: string[] = [];
        const turnId = context.turnId || 'default';

        for (const relPath of targets) {
            try {
                const targetPath = resolveSafePath(relPath, context.workspacePath);

                // Safety check to prevent deleting the workspace root directory
                if (targetPath === context.workspacePath) {
                    errors.push(`Deleting workspace root "${relPath}" is not permitted.`);
                    continue;
                }

                if (!fs.existsSync(targetPath)) {
                    errors.push(`Item does not exist: ${relPath}`);
                    continue;
                }

                await TurnSnapshotManager.getInstance().recordBeforeDeletion(turnId, targetPath);
                await fs.promises.rm(targetPath, { recursive: true, force: true });
                deleted.push(relPath);
            } catch (err: any) {
                errors.push(`Failed to delete "${relPath}": ${err.message || err}`);
            }
        }

        const results: string[] = [];
        if (deleted.length > 0) {
            results.push(`Successfully deleted ${deleted.length} item(s): ${deleted.join(', ')}`);
        }
        if (errors.length > 0) {
            results.push(`Errors (${errors.length}):\n${errors.join('\n')}`);
        }

        return results.join('\n\n');
    }
}
