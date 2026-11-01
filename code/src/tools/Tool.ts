import * as path from 'path';
import { IHostServices } from '../core/IHostServices';

/**
 * Interface representing the context provided to each tool during execution.
 */
export interface ToolContext {
    /** The absolute path of the workspace. */
    workspacePath: string;
    /** The absolute path to the extension's root directory. */
    extensionPath?: string;
    /** The unique ID of the active chat or execution turn. */
    turnId?: string;
    /** Optional host services adapter (VS Code IDE or Standalone Desktop). */
    hostServices?: IHostServices;
}

/**
 * Interface for OpenAI-compatible function declaration schema.
 */
export interface FunctionDeclaration {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: {
            type: string;
            properties: Record<string, any>;
            required?: string[];
        };
    };
}

/**
 * Abstract base class that all agent tools must extend.
 * Provides OOP structure, schema generation for function calling, and output truncation utilities.
 */
export abstract class Tool {
    /** The name of the tool, matching the tool type in system instructions. */
    abstract readonly name: string;

    /** Description of what the tool does. */
    abstract readonly description: string;

    /** Maximum number of lines returned by this tool. Subclasses may override this. */
    protected readonly maxOutputLines: number = 150;

    /** Maximum number of UTF-8 bytes returned by this tool. Subclasses may override this. */
    protected readonly maxOutputBytes: number = 8000;

    /**
     * Generates the OpenAI-compatible function declaration schema for this tool.
     */
    abstract getFunctionDeclaration(): FunctionDeclaration;

    /**
     * Executes the tool's action.
     * @param args The arguments passed to the tool.
     * @param context The execution context of the tool.
     * @returns A promise that resolves to the string representation of the tool output.
     */
    abstract execute(args: any, context: ToolContext): Promise<string>;

    /**
     * Truncates large tool execution output to save context window tokens.
     * Keeps head and tail lines with a clear truncation marker.
     */
    protected truncateOutput(
        output: string,
        maxLines: number = this.maxOutputLines,
        maxBytes: number = this.maxOutputBytes
    ): string {
        if (!output) {
            return output;
        }

        let result = output;

        // Truncate by complete lines first, retaining useful context from both ends.
        const allLines = result.split('\n');
        if (allLines.length > maxLines) {
            const headCount = Math.floor(maxLines * 0.6);
            const tailCount = maxLines - headCount;
            const head = allLines.slice(0, headCount).join('\n');
            const tail = allLines.slice(-tailCount).join('\n');
            const omitted = allLines.length - maxLines;
            result = `${head}\n\n... [${omitted} lines omitted] ...\n\n${tail}`;
        }

        if (Buffer.byteLength(result, 'utf8') <= maxBytes) {
            return result;
        }

        // Keep the byte limit UTF-8 safe and avoid cutting through a line where possible.
        const marker = '\n... [Output truncated at byte limit]';
        const availableBytes = Math.max(0, maxBytes - Buffer.byteLength(marker, 'utf8'));
        const lines = result.split('\n');
        let byteLength = 0;
        const keptLines: string[] = [];

        for (const line of lines) {
            const lineBytes = Buffer.byteLength(line, 'utf8');
            const separatorBytes = keptLines.length > 0 ? 1 : 0;
            if (byteLength + separatorBytes + lineBytes > availableBytes) {
                break;
            }
            keptLines.push(line);
            byteLength += separatorBytes + lineBytes;
        }

        if (keptLines.length > 0) {
            return `${keptLines.join('\n')}${marker}`;
        }

        // A single very long line cannot fit as a complete line; Buffer safely handles
        // the UTF-8 boundary and the marker makes the truncation explicit.
        return `${Buffer.from(result, 'utf8').subarray(0, availableBytes).toString('utf8')}${marker}`;
    }
}

/**
 * Resolves a relative path to an absolute path inside the active workspace directory.
 * Throws an error if the path tries to traverse outside of the workspace directory.
 * @param relativePath The relative path supplied by the LLM.
 * @param workspacePath The absolute path to the workspace directory.
 * @returns The resolved absolute path.
 */
export function resolveSafePath(relativePath: string, workspacePath: string): string {
    const resolved = path.resolve(workspacePath, relativePath);
    if (!resolved.startsWith(workspacePath)) {
        throw new Error(`Path traversal violation: Access to path "${relativePath}" outside the workspace is denied.`);
    }
    return resolved;
}
