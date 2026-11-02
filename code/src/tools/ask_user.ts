import { Tool, ToolContext, FunctionDeclaration } from './Tool';

/**
 * Tool for suspending autonomous execution to solicit interactive human-in-the-loop clarification or decisions.
 */
export class AskUserTool extends Tool {
    public readonly name = 'ask_user';
    public readonly description = 'Asks the user a question with interactive clickable option buttons or multiple-choice answers (essential for games like Akinator, quizzes, branching decisions, task selection, or user preferences). Execution suspends and resumes once the user selects an option or submits custom input.';

    public getFunctionDeclaration(): FunctionDeclaration {
        return {
            type: 'function',
            function: {
                name: this.name,
                description: this.description,
                parameters: {
                    type: 'object',
                    properties: {
                        question: {
                            type: 'string',
                            description: 'The exact question or clarification prompt for the user.'
                        },
                        options: {
                            type: 'array',
                            items: { type: 'string' },
                            description: 'List of choice options for the user to select from.'
                        },
                        allowCustom: {
                            type: 'boolean',
                            description: 'Whether the user can provide custom typed text instead of choosing an option (default true).'
                        }
                    },
                    required: ['question']
                }
            }
        };
    }

    /**
     * Executes the ask_user tool by delegating suspension and user prompt rendering to host services.
     * Suspends execution flow until the user clicks an option or submits an answer in the chat UI.
     * @param args Parameter dictionary containing the question and optional choices.
     * @param context Execution context containing host services.
     * @returns A promise resolving to the user's selected choice or typed input.
     */
    public async execute(
        args: { question: string; options?: string[]; allowCustom?: boolean },
        context: ToolContext
    ): Promise<string> {
        if (!context.hostServices || typeof context.hostServices.askUser !== 'function') {
            return `[ask_user: Interactive host services are not available in this environment. Question was: ${args.question}]`;
        }

        try {
            const answer = await context.hostServices.askUser(args.question, args.options, args.allowCustom);
            return answer || '[User provided empty response]';
        } catch (error: any) {
            return `[ask_user error: ${error?.message || error}]`;
        }
    }
}

