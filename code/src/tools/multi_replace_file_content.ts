import * as fs from 'fs';
import { Tool, ToolContext, FunctionDeclaration, resolveSafePath } from './Tool';
import { FileReplacementHelper, ReplacementChunk } from './FileReplacementHelper';
import { TurnSnapshotManager } from '../services/TurnSnapshotManager';

/**
 * Tool for replacing multiple non-contiguous blocks of lines in a file.
 */
export class MultiReplaceFileContentTool extends Tool {
    public readonly name = 'multi_replace_file_content';
    public readonly description = 'Replaces multiple non-contiguous blocks of lines in a single file in one pass.';

    public getFunctionDeclaration(): FunctionDeclaration {
        return {
            type: 'function',
            function: {
                name: this.name,
                description: this.description,
                parameters: {
                    type: 'object',
                    properties: {
                        path: { type: 'string', description: 'Relative path of the target file.' },
                        chunks: {
                            type: 'array',
                            description: 'List of replacement chunk objects.',
                            items: {
                                type: 'object',
                                properties: {
                                    startLine: { type: 'number', description: '1-indexed starting line number.' },
                                    endLine: { type: 'number', description: '1-indexed ending line number.' },
                                    targetContent: { type: 'string', description: 'Exact content expected inside line range.' },
                                    replacementContent: { type: 'string', description: 'New content to replace the target block.' }
                                },
                                required: ['startLine', 'endLine', 'targetContent', 'replacementContent']
                            }
                        }
                    },
                    required: ['path', 'chunks']
                }
            }
        };
    }

    /**
     * Executes multiple non-contiguous replacements within a file.
     * Applies changes in descending order of startLine to maintain correct line number references.
     * @param args Arguments containing path and chunks array.
     * @param context The current execution context containing the workspace path.
     * @returns A status message indicating success or an error details.
     */
    public async execute(
        args: { path: string; chunks: ReplacementChunk[] },
        context: ToolContext
    ): Promise<string> {
        const targetPath = resolveSafePath(args.path, context.workspacePath);
        if (!fs.existsSync(targetPath)) {
            return `File does not exist: ${args.path}`;
        }

        if (!args.chunks || !Array.isArray(args.chunks) || args.chunks.length === 0) {
            return `Error: Chunks list is empty or invalid.`;
        }

        const content = await fs.promises.readFile(targetPath, 'utf8');
        const lines = content.split(/\r?\n/);

        const error = FileReplacementHelper.applyChunks(lines, args.chunks, args.path);
        if (error) {
            return error;
        }

        const turnId = context.turnId || 'default';
        await TurnSnapshotManager.getInstance().recordBeforeMutation(turnId, targetPath);

        await fs.promises.writeFile(targetPath, lines.join('\n'), 'utf8');
        return `Successfully updated file: ${args.path} (${args.chunks.length} chunks applied)`;
    }
}
