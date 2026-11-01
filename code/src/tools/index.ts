import { Tool } from './Tool';
import { ReadFileTool } from './read_file';
import { WriteFileTool } from './write_file';
import { EditFileTool } from './edit_file';
import { ListDirTool } from './list_dir';
import { RunCommandTool } from './run_command';
import { ReplaceFileContentTool } from './replace_file_content';
import { MultiReplaceFileContentTool } from './multi_replace_file_content';
import { GrepSearchTool } from './grep_search';
import { GetDiagnosticsTool } from './get_diagnostics';
import { SymbolSearchTool } from './symbol_search';
import { FetchUrlTool } from './fetch_url';
import { DeleteItemTool } from './delete_item';
import { WebSearchTool } from './web_search';
import { UtilityToolsTool } from './utility_tools';

export * from './Tool';
export * from './McpProcessBridge';
export * from './read_file';
export * from './write_file';
export * from './edit_file';
export * from './list_dir';
export * from './run_command';
export * from './replace_file_content';
export * from './multi_replace_file_content';
export * from './grep_search';
export * from './get_diagnostics';
export * from './symbol_search';
export * from './fetch_url';
export * from './delete_item';
export * from './web_search';
export * from './utility_tools';

/**
 * Returns an array of available tools filtered by active mode and workspace context.
 * @param mode The active mode ('chat' | 'agent' | 'planning' | 'ask').
 * @param hasWorkspace Whether a workspace directory is currently selected.
 * @returns Array of Tool instances.
 */
export function getRegisteredTools(mode: 'chat' | 'agent' | 'planning' | 'ask' | string = 'agent', hasWorkspace: boolean = true): Tool[] {
    const utilityTool = new UtilityToolsTool();
    const fetchUrlTool = new FetchUrlTool();
    const webSearchTool = new WebSearchTool();

    // 1. Chat Mode WITHOUT Workspace: only utilities and web access
    if (mode === 'chat' && !hasWorkspace) {
        return [
            utilityTool,
            fetchUrlTool,
            webSearchTool
        ];
    }

    // 2. Chat or Ask Mode WITH Workspace: read-only workspace inspection + utilities + web
    if ((mode === 'chat' || mode === 'ask') && hasWorkspace) {
        return [
            new ReadFileTool(),
            new ListDirTool(),
            new GrepSearchTool(),
            new GetDiagnosticsTool(),
            new SymbolSearchTool(),
            utilityTool,
            fetchUrlTool,
            webSearchTool
        ];
    }

    // 3. Agent & Planning Modes (Full Workspace Developer Tools)
    return [
        new ReadFileTool(),
        new WriteFileTool(),
        new EditFileTool(),
        new ListDirTool(),
        new RunCommandTool(),
        new ReplaceFileContentTool(),
        new MultiReplaceFileContentTool(),
        new GrepSearchTool(),
        new GetDiagnosticsTool(),
        new SymbolSearchTool(),
        new FetchUrlTool(),
        new DeleteItemTool(),
        new WebSearchTool(),
        utilityTool
    ];
}
