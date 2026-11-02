/**
 * Multi-stage JSON repair pipeline designed to heuristically sanitize and parse malformed JSON payloads.
 * Helps local LLMs recover from unescaped newlines in code strings, single quotes, and trailing commas.
 */
export class JsonRepairPipeline {
    /**
     * Attempts strict parsing followed by progressive heuristic repair stages on a raw JSON candidate string.
     * Operates purely in memory on string input without mutating files or application runtime state.
     * @param raw Raw string candidate extracted from model completion.
     * @returns Parsed object and boolean repair indicator, or null if string cannot be parsed.
     */
    public static parseWithRepair(raw: string): { parsed: any; repaired: boolean } | null {
        if (!raw || typeof raw !== 'string') return null;
        const trimmed = raw.trim();
        if (!trimmed) return null;

        // Stage 0: Strict standard parse
        try {
            const parsed = JSON.parse(trimmed);
            if (parsed && typeof parsed === 'object') {
                return { parsed, repaired: false };
            }
        } catch {
            // Proceed to heuristic repair stages
        }

        let candidate = trimmed;

        // Stage 1: Strip markdown code fences if wrapped
        candidate = candidate.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

        // Stage 2: Strip JavaScript-style comments outside of string literals
        candidate = candidate.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^\\:])\/\/.*$/gm, '$1');

        // Stage 3: Normalize trailing commas before closing braces/brackets
        candidate = candidate.replace(/,(\s*[}\]])/g, '$1');

        // Stage 4: Try parsing after basic cleanup
        try {
            const parsed = JSON.parse(candidate);
            if (parsed && typeof parsed === 'object') {
                return { parsed, repaired: true };
            }
        } catch {
            // Continue to advanced string repair
        }

        // Stage 5: Convert single-quoted keys and string values to standard double quotes
        candidate = this.convertSingleQuotes(candidate);

        // Stage 6: Fix unescaped control characters and newlines inside quoted strings
        candidate = this.escapeRawNewlinesInStrings(candidate);

        // Stage 7: Remove trailing commas again in case quote conversion revealed new ones
        candidate = candidate.replace(/,(\s*[}\]])/g, '$1');

        try {
            const parsed = JSON.parse(candidate);
            if (parsed && typeof parsed === 'object') {
                return { parsed, repaired: true };
            }
        } catch {
            // Irreparable syntax error
        }

        return null;
    }

    /**
     * Escapes unescaped literal newline and carriage return characters within JSON string literals.
     * Preserves existing valid escape sequences while converting literal line breaks to \n.
     * @param jsonText JSON candidate string.
     * @returns JSON string with escaped internal newlines.
     */
    private static escapeRawNewlinesInStrings(jsonText: string): string {
        let inString = false;
        let isEscaped = false;
        let result = '';

        for (let i = 0; i < jsonText.length; i++) {
            const char = jsonText[i];

            if (char === '"' && !isEscaped) {
                inString = !inString;
                result += char;
            } else if (inString && (char === '\n' || char === '\r')) {
                // If it's a carriage return right before a newline, skip it
                if (char === '\r' && jsonText[i + 1] === '\n') {
                    continue;
                }
                result += '\\n';
            } else {
                result += char;
            }

            if (char === '\\' && !isEscaped) {
                isEscaped = true;
            } else {
                isEscaped = false;
            }
        }

        return result;
    }

    /**
     * Converts single-quoted property keys and string values to valid double-quoted JSON strings.
     * Operates purely in memory on string buffers.
     * @param str Candidate JSON string with single quotes.
     * @returns Normalized string with double quotes.
     */
    private static convertSingleQuotes(str: string): string {
        // Replace single quotes surrounding property keys or string values, ignoring escaped quotes
        return str.replace(/'((?:\\.|[^'\\])*)'/g, (_match, group) => {
            const escapedDouble = group.replace(/"/g, '\\"');
            return `"${escapedDouble}"`;
        });
    }
}

