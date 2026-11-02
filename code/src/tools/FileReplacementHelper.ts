import { FuzzyMatchHelper } from './FuzzyMatchHelper';

/**
 * ReplacementChunk interface representing a single block edit request.
 */
export interface ReplacementChunk {
    startLine: number;
    endLine: number;
    targetContent: string;
    replacementContent: string;
}

/**
 * Options configuring line-drift tolerance and whitespace adaptation.
 */
export interface ReplacementOptions {
    autoRelocate?: boolean;
    whitespaceTolerant?: boolean;
    windowRadius?: number;
}

/**
 * Result returned by transactional replacement operations.
 */
export interface TransactionalReplacementResult {
    success: boolean;
    content?: string;
    error?: string;
    notices: string[];
}

/**
 * Helper class for validating line boundaries, relocating shifted targets, and applying atomic text replacements.
 */
export class FileReplacementHelper {
    /**
     * Scans surrounding lines to locate target content that has shifted due to earlier edits.
     * Operates purely in memory without mutating file lines or application state.
     * @param lines Array of all file lines.
     * @param targetContent Expected text block to locate.
     * @param requestedStartLine Original 1-indexed start line requested by the model.
     * @param windowRadius Number of lines above and below to scan (default 15).
     * @returns Shifted target coordinates and offset if found, or null.
     */
    public static findShiftedTarget(
        lines: string[],
        targetContent: string,
        requestedStartLine: number,
        windowRadius: number = 15
    ): { found: boolean; newStartLine: number; newEndLine: number; offset: number; whitespaceMatch: boolean } | null {
        const targetLines = targetContent.split(/\r?\n/);
        const targetLen = targetLines.length;
        if (targetLen === 0 || lines.length === 0) return null;

        const reqIdx = requestedStartLine - 1;
        const minIdx = Math.max(0, reqIdx - windowRadius);
        const maxIdx = Math.min(lines.length - targetLen, reqIdx + windowRadius);

        const targetNorm = targetContent.replace(/\r?\n/g, '\n');
        const targetWsNorm = FuzzyMatchHelper.normalizeWhitespace(targetContent);

        // Pass 1: Look for exact match within window
        for (let i = minIdx; i <= maxIdx; i++) {
            const candidate = lines.slice(i, i + targetLen).join('\n');
            if (candidate === targetNorm) {
                return {
                    found: true,
                    newStartLine: i + 1,
                    newEndLine: i + targetLen,
                    offset: (i + 1) - requestedStartLine,
                    whitespaceMatch: false
                };
            }
        }

        // Pass 2: Look for normalized whitespace match within window
        for (let i = minIdx; i <= maxIdx; i++) {
            const candidate = lines.slice(i, i + targetLen).join('\n');
            if (FuzzyMatchHelper.normalizeWhitespace(candidate) === targetWsNorm) {
                return {
                    found: true,
                    newStartLine: i + 1,
                    newEndLine: i + targetLen,
                    offset: (i + 1) - requestedStartLine,
                    whitespaceMatch: true
                };
            }
        }

        return null;
    }

    /**
     * Adapts replacement content indentation to match the baseline indentation of the destination file block.
     * Formats replacement lines purely in memory without modifying global environment state.
     * @param replacementContent Replacement text to adapt.
     * @param baseIndentation Leading whitespace string extracted from destination block.
     * @returns Re-indented replacement string.
     */
    public static adaptIndentation(replacementContent: string, baseIndentation: string): string {
        const lines = replacementContent.split(/\r?\n/);
        if (lines.length <= 1) return replacementContent;

        // Detect existing common indentation of replacement
        const nonBlank = lines.filter(l => l.trim().length > 0);
        if (nonBlank.length === 0) return replacementContent;

        const firstLineIndentMatch = nonBlank[0].match(/^(\s*)/);
        const existingIndent = firstLineIndentMatch ? firstLineIndentMatch[1] : '';

        return lines.map((line, idx) => {
            if (line.trim().length === 0) return line;
            if (idx === 0) return line;
            if (line.startsWith(existingIndent)) {
                return baseIndentation + line.slice(existingIndent.length);
            }
            return line;
        }).join('\n');
    }

    /**
     * Executes atomic two-phase transactional replacements on a file content string.
     * Validates all chunks in Phase 1 before applying descending edits to lines in Phase 2.
     * @param rawContent Full original content of the file.
     * @param chunks List of replacement chunk blocks.
     * @param filePath Target file path for descriptive error messages.
     * @param options Configurable drift tolerance and whitespace adaptation settings.
     * @returns Transactional result with updated content and relocation notices.
     */
    public static applyChunksTransactional(
        rawContent: string,
        chunks: ReplacementChunk[],
        filePath: string,
        options: ReplacementOptions = {}
    ): TransactionalReplacementResult {
        const autoRelocate = options.autoRelocate !== false;
        const whitespaceTolerant = options.whitespaceTolerant !== false;
        const windowRadius = options.windowRadius || 15;

        const isCRLF = rawContent.includes('\r\n');
        const lines = rawContent.split(/\r?\n/);
        const notices: string[] = [];

        // Phase 1: Validate and resolve coordinates for every chunk
        const resolvedChunks: ReplacementChunk[] = [];

        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            let startLine = chunk.startLine;
            let endLine = chunk.endLine;
            let replacementContent = chunk.replacementContent;

            const startIdx = startLine - 1;
            const endIdx = endLine - 1;

            let isMatch = false;

            if (startIdx >= 0 && endIdx < lines.length && startIdx <= endIdx) {
                const targetLinesFromFile = lines.slice(startIdx, endIdx + 1);
                const fileBlock = targetLinesFromFile.join('\n');
                const targetNorm = chunk.targetContent.replace(/\r?\n/g, '\n');

                if (fileBlock === targetNorm) {
                    isMatch = true;
                } else if (whitespaceTolerant && FuzzyMatchHelper.normalizeWhitespace(fileBlock) === FuzzyMatchHelper.normalizeWhitespace(chunk.targetContent)) {
                    isMatch = true;
                    const baseIndent = (targetLinesFromFile[0].match(/^(\s*)/) || ['', ''])[1];
                    replacementContent = this.adaptIndentation(replacementContent, baseIndent);
                    notices.push(`[Notice] Chunk ${i + 1}: Matched target with normalized whitespace at lines ${startLine}-${endLine}.`);
                }
            }

            // If direct match failed, attempt windowed line-drift relocation
            if (!isMatch && autoRelocate) {
                const relocated = this.findShiftedTarget(lines, chunk.targetContent, startLine, windowRadius);
                if (relocated && relocated.found) {
                    startLine = relocated.newStartLine;
                    endLine = relocated.newEndLine;
                    isMatch = true;

                    if (relocated.whitespaceMatch) {
                        const targetLinesFromFile = lines.slice(startLine - 1, endLine);
                        const baseIndent = (targetLinesFromFile[0].match(/^(\s*)/) || ['', ''])[1];
                        replacementContent = this.adaptIndentation(replacementContent, baseIndent);
                    }

                    const sign = relocated.offset >= 0 ? `+${relocated.offset}` : `${relocated.offset}`;
                    notices.push(`[Notice] Chunk ${i + 1}: Target content relocated by ${sign} lines (from ${chunk.startLine}-${chunk.endLine} to ${startLine}-${endLine}).`);
                }
            }

            // Fallback: check high-confidence fuzzy match across the file
            if (!isMatch && whitespaceTolerant) {
                const best = FuzzyMatchHelper.findBestMatchingRange(lines, chunk.targetContent, startLine, endLine);
                if (best && best.score >= 0.98) {
                    startLine = best.startLine;
                    endLine = best.endLine;
                    isMatch = true;
                    notices.push(`[Notice] Chunk ${i + 1}: Found high-confidence match (${Math.round(best.score * 100)}%) relocated to lines ${startLine}-${endLine}.`);
                }
            }

            if (!isMatch) {
                // Transaction aborted in Phase 1 before any mutation
                const errorFeedback = FuzzyMatchHelper.formatMismatchFeedback(
                    filePath,
                    { startLine: chunk.startLine, endLine: chunk.endLine },
                    chunk.targetContent,
                    lines
                );
                return {
                    success: false,
                    error: `Phase 1 Transaction Aborted: Chunk ${i + 1} validation failed.\n${errorFeedback}`,
                    notices: []
                };
            }

            resolvedChunks.push({
                startLine,
                endLine,
                targetContent: chunk.targetContent,
                replacementContent
            });
        }

        // Phase 2: Apply resolved chunks in descending startLine order to prevent line index corruption
        const workingLines = [...lines];
        const sortedChunks = [...resolvedChunks].sort((a, b) => b.startLine - a.startLine);

        for (const chunk of sortedChunks) {
            const startIdx = chunk.startLine - 1;
            const count = chunk.endLine - chunk.startLine + 1;
            const replacementLines = chunk.replacementContent.split(/\r?\n/);
            workingLines.splice(startIdx, count, ...replacementLines);
        }

        const delimiter = isCRLF ? '\r\n' : '\n';
        return {
            success: true,
            content: workingLines.join(delimiter),
            notices
        };
    }

    /**
     * Backward-compatible helper method that applies chunks to lines in place.
     * Uses applyChunksTransactional under the hood and reports error or empty string on success.
     * @param lines Array of file lines modified in place upon success.
     * @param chunks List of replacement chunks.
     * @param filePath Path of the target file for error reporting.
     * @param options Configurable drift tolerance options.
     * @returns Error string or empty string on successful replacement.
     */
    public static applyChunks(
        lines: string[],
        chunks: ReplacementChunk[],
        filePath: string,
        options: ReplacementOptions = {}
    ): string {
        const raw = lines.join('\n');
        const result = this.applyChunksTransactional(raw, chunks, filePath, options);
        if (!result.success) {
            return result.error || 'Replacement failed during validation.';
        }
        if (result.content !== undefined) {
            const newLines = result.content.split(/\r?\n/);
            lines.length = 0;
            lines.push(...newLines);
        }
        return '';
    }
}
