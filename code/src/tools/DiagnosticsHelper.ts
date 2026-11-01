import * as path from 'path';
import * as fs from 'fs';
import { IHostServices } from '../core/IHostServices';

/**
 * Helper for capturing post-edit compiler and syntax diagnostics so the AI agent can self-heal errors.
 */
export class DiagnosticsHelper {
    /**
     * Retrieves a compact diagnostics note for modified workspace files.
     * @param targetFilePath Relative or absolute path of modified file.
     * @param workspacePath Workspace root path.
     * @param isNewFile Whether the file was newly created.
     * @param hostServices Optional host services adapter.
     * @returns Formatted diagnostics note or empty string.
     */
    public static async getPostEditDiagnosticsNote(
        targetFilePath: string,
        workspacePath: string,
        isNewFile: boolean = false,
        hostServices?: IHostServices
    ): Promise<string> {
        if (hostServices) {
            return await hostServices.getPostEditDiagnostics(targetFilePath, workspacePath, isNewFile);
        }

        try {
            const absolutePath = path.isAbsolute(targetFilePath)
                ? targetFilePath
                : path.join(workspacePath, targetFilePath);

            if (!fs.existsSync(absolutePath)) {
                return '';
            }

            if (targetFilePath.endsWith('.json')) {
                try {
                    const content = fs.readFileSync(absolutePath, 'utf8');
                    JSON.parse(content);
                } catch (e: any) {
                    return `\n[Diagnostics note]: errors: [${targetFilePath}: Invalid JSON syntax - ${e.message}]`;
                }
            }
            return '';
        } catch {
            return '';
        }
    }
}
