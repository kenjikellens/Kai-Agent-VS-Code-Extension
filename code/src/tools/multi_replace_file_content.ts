import * as fs from 'fs';
import { Tool, ToolContext, FunctionDeclaration, resolveSafePath } from './Tool';
import { FileReplacementHelper, ReplacementChunk } from './FileReplacementHelper';
import { TurnSnapshotManager } from '../services/TurnSnapshotManager';

/**
 * Tool for replacing multiple non-contiguous blocks of lines in a file with atomic multi-chunk commit.
 */
export class MultiReplaceFileContentTool extends Tool {
    public readonly name = 'multi_replace_file_content';
    public readonly description = 'Replaces multiple non-contiguous blocks of lines in a single file in one pass with atomic verification.';

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
                        },
                        autoRelocate: { type: 'boolean', description: 'Whether to auto-detect targets if lines shifted by +/- 15 lines (default true).' },
                        whitespaceTolerant: { type: 'boolean', description: 'Whether to allow minor indentation differences (default true).' }
                    },
                    required: ['path', 'chunks']
                }
            }
        };
    }

    /**
     * Executes multiple non-contiguous replacements within a file transactionally.
     * Aborts without writing to disk if any chunk fails validation, and applies validated chunks in descending order.
     * @param args Arguments containing path, chunks array, and drift options.
     * @param context The current execution context containing the workspace path.
     * @returns A status message indicating success with chunk counts and notices or an error message.
     */
    public async execute(
        args: {
            path: string;
            chunks: ReplacementChunk[];
            autoRelocate?: boolean;
            whitespaceTolerant?: boolean;
        },
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

        const result = FileReplacementHelper.applyChunksTransactional(
            content,
            args.chunks,
            args.path,
            {
                autoRelocate: args.autoRelocate,
                whitespaceTolerant: args.whitespaceTolerant
            }
        );

        if (!result.success || result.content === undefined) {
            return result.error || 'Failed to replace chunks transactionally.';
        }

        const turnId = context.turnId || 'default';
        await TurnSnapshotManager.getInstance().recordBeforeMutation(turnId, targetPath);

        await fs.promises.writeFile(targetPath, result.content, 'utf8');

        const noticeSuffix = result.notices.length > 0 ? `\n${result.notices.join('\n')}` : '';
        return `Successfully updated file: ${args.path} (${args.chunks.length} chunks applied transactionally)${noticeSuffix}`;
    }
}
