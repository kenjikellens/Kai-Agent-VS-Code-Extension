import * as fs from 'fs';
import { Tool, ToolContext, FunctionDeclaration, resolveSafePath } from './Tool';
import { FileReplacementHelper } from './FileReplacementHelper';
import { TurnSnapshotManager } from '../services/TurnSnapshotManager';

/**
 * Tool for replacing a single contiguous block of lines in a file.
 */
export class ReplaceFileContentTool extends Tool {
    public readonly name = 'replace_file_content';
    public readonly description = 'Replaces a contiguous block of lines in an existing file after verifying line range and target content match.';

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
                        startLine: { type: 'number', description: '1-indexed starting line number.' },
                        endLine: { type: 'number', description: '1-indexed ending line number.' },
                        targetContent: { type: 'string', description: 'Exact content expected inside line range.' },
                        replacementContent: { type: 'string', description: 'New content to replace the target block.' }
                    },
                    required: ['path', 'startLine', 'endLine', 'targetContent', 'replacementContent']
                }
            }
        };
    }

    /**
     * Executes the replacement of a contiguous block of text within a file.
     * @param args Arguments containing path, startLine, endLine, targetContent, and replacementContent.
     * @param context The current execution context containing the workspace path.
     * @returns A status message indicating success or an error details.
     */
    public async execute(
        args: { path: string; startLine: number; endLine: number; targetContent: string; replacementContent: string },
        context: ToolContext
    ): Promise<string> {
        const targetPath = resolveSafePath(args.path, context.workspacePath);
        if (!fs.existsSync(targetPath)) {
            return `File does not exist: ${args.path}`;
        }

        const content = await fs.promises.readFile(targetPath, 'utf8');
        const lines = content.split(/\r?\n/);

        const error = FileReplacementHelper.applyChunks(lines, [
            {
                startLine: args.startLine,
                endLine: args.endLine,
                targetContent: args.targetContent,
                replacementContent: args.replacementContent
            }
        ], args.path);

        if (error) {
            return error;
        }

        const turnId = context.turnId || 'default';
        await TurnSnapshotManager.getInstance().recordBeforeMutation(turnId, targetPath);

        await fs.promises.writeFile(targetPath, lines.join('\n'), 'utf8');
        return `Successfully updated file: ${args.path} (lines ${args.startLine}-${args.endLine})`;
    }
}
