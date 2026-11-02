/**
 * Normalization service that maps common hallucinated tool names and parameter keys to registered catalog equivalents.
 * Improves execution resilience for open-weight models that produce slight deviations from exact tool schemas.
 */
export class ToolAliasDictionary {
    private static readonly TOOL_NAME_ALIASES: Record<string, string> = {
        'run_shell': 'run_command',
        'shell': 'run_command',
        'exec': 'run_command',
        'terminal': 'run_command',
        'cmd': 'run_command',
        'bash': 'run_command',
        'powershell': 'run_command',
        'execute_command': 'run_command',
        'execute_shell': 'run_command',

        'view_file': 'read_file',
        'cat': 'read_file',
        'show_file': 'read_file',
        'get_file': 'read_file',
        'open_file': 'read_file',
        'file_content': 'read_file',
        'read': 'read_file',

        'edit': 'replace_file_content',
        'modify_file': 'replace_file_content',
        'patch_file': 'replace_file_content',
        'replace_in_file': 'replace_file_content',
        'edit_file_content': 'replace_file_content',
        'replace_file': 'replace_file_content',

        'multi_edit': 'multi_replace_file_content',
        'multi_replace': 'multi_replace_file_content',
        'multi_patch': 'multi_replace_file_content',

        'write': 'write_file',
        'create_file': 'write_file',
        'new_file': 'write_file',
        'save_file': 'write_file',
        'make_file': 'write_file',

        'delete_file': 'delete_item',
        'remove_file': 'delete_item',
        'rm': 'delete_item',
        'delete': 'delete_item',
        'remove': 'delete_item',

        'grep': 'grep_search',
        'search_files': 'grep_search',
        'find_in_files': 'grep_search',
        'search': 'grep_search',

        'search_symbols': 'symbol_search',
        'find_symbol': 'symbol_search',
        'symbols': 'symbol_search',
        'workspace_symbols': 'symbol_search',

        'websearch': 'web_search',
        'full-web-search': 'web_search',
        'search_web': 'web_search',
        'google_search': 'web_search',
        'internet_search': 'web_search',

        'diagnostics': 'get_diagnostics',
        'get_errors': 'get_diagnostics',
        'lint': 'get_diagnostics',
        'compiler_errors': 'get_diagnostics',

        'ls': 'list_dir',
        'dir': 'list_dir',
        'list_directory': 'list_dir',
        'list_files': 'list_dir',

        'clarify': 'ask_user',
        'question': 'ask_user',
        'user_input': 'ask_user',
        'prompt_user': 'ask_user'
    };

    private static readonly PARAMETER_KEY_ALIASES: Record<string, string> = {
        'file': 'path',
        'filename': 'path',
        'filepath': 'path',
        'target_file': 'path',
        'files': 'paths',
        'filenames': 'paths',

        'code': 'content',
        'text': 'content',
        'data': 'content',
        'body': 'content',

        'cmd': 'command',
        'command_line': 'command',
        'script': 'command',

        'pattern': 'query',
        'search_term': 'query',

        'target': 'targetContent',
        'old_content': 'targetContent',
        'oldContent': 'targetContent',

        'replacement': 'replacementContent',
        'new_content': 'replacementContent',
        'newContent': 'replacementContent',

        'start': 'startLine',
        'start_line': 'startLine',

        'end': 'endLine',
        'end_line': 'endLine'
    };

    /**
     * Resolves a tool candidate name against known semantic aliases.
     * @param candidate Raw tool name supplied in payload.
     * @returns Canonical tool name or candidate if no alias exists.
     */
    public static resolveToolName(candidate: string): string {
        const lower = candidate.trim().toLowerCase();
        return this.TOOL_NAME_ALIASES[lower] || lower;
    }

    /**
     * Normalizes an argument dictionary by replacing common parameter aliases with canonical schema keys.
     * @param rawArgs Raw argument dictionary from parsed payload.
     * @returns Normalized copy of arguments.
     */
    public static normalizeArgs(rawArgs: any): any {
        if (!rawArgs || typeof rawArgs !== 'object' || Array.isArray(rawArgs)) {
            return rawArgs;
        }

        const normalized: Record<string, any> = {};
        for (const [key, value] of Object.entries(rawArgs)) {
            const canonicalKey = this.PARAMETER_KEY_ALIASES[key] || key;
            normalized[canonicalKey] = value;
        }

        // If chunks array exists, normalize keys inside each chunk
        if (Array.isArray(normalized.chunks)) {
            normalized.chunks = normalized.chunks.map(chunk => {
                if (chunk && typeof chunk === 'object') {
                    const normChunk: Record<string, any> = {};
                    for (const [k, v] of Object.entries(chunk)) {
                        const ck = this.PARAMETER_KEY_ALIASES[k] || k;
                        normChunk[ck] = v;
                    }
                    return normChunk;
                }
                return chunk;
            });
        }

        return normalized;
    }

    /**
     * Attempts to infer tool name from argument shapes when model omits the type/name property.
     * @param args Parameter dictionary.
     * @returns Inferred tool name string or null.
     */
    public static inferToolType(args: any): string | null {
        if (!args || typeof args !== 'object') return null;

        if (Array.isArray(args.chunks) || (args.targetContent && args.replacementContent)) {
            return args.chunks && args.chunks.length > 1 ? 'multi_replace_file_content' : 'replace_file_content';
        }
        if ((args.path || args.paths) && (args.action === 'delete' || args.paths !== undefined)) {
            return 'delete_item';
        }
        if (args.path && args.content !== undefined) {
            return 'write_file';
        }
        if (args.path && args.content === undefined && !args.command && !args.targetContent) {
            return 'read_file';
        }
        if (args.command) {
            return 'run_command';
        }
        if (args.query && !args.command && !args.url) {
            return 'grep_search';
        }
        if (args.url) {
            return 'fetch_url';
        }
        if (args.question) {
            return 'ask_user';
        }

        return null;
    }
}

