import { Tool, ToolContext, FunctionDeclaration } from './Tool';

/**
 * UtilityToolsTool bundles helpful daily utility operations:
 * time lookup, safe calculation, unit conversion, text statistics, and UUID/token generation.
 */
export class UtilityToolsTool extends Tool {
    public readonly name = 'utility_tools';
    public readonly description = 'Executes essential utility actions: get current time/date, perform math calculations, convert units, compute text statistics, or generate random UUIDs/tokens.';
    protected readonly maxOutputLines = 100;
    protected readonly maxOutputBytes = 6000;

    public readonly parameterSchema = {
        type: 'object',
        properties: {
            action: {
                type: 'string',
                enum: ['get_time', 'calculate', 'unit_converter', 'text_stats', 'uuid_random'],
                description: 'The utility action to perform.'
            },
            expression: {
                type: 'string',
                description: 'Mathematical expression for calculate action (e.g. "(145 * 12) / 4" or "Math.sqrt(256)").'
            },
            value: {
                type: 'number',
                description: 'Numerical value for unit_converter.'
            },
            from_unit: {
                type: 'string',
                description: 'Source unit for unit_converter (e.g. "celsius", "fahrenheit", "km", "miles", "kg", "lbs", "mb", "gb").'
            },
            to_unit: {
                type: 'string',
                description: 'Target unit for unit_converter (e.g. "fahrenheit", "celsius", "miles", "km", "lbs", "kg", "gb", "mb").'
            },
            text: {
                type: 'string',
                description: 'Text string for text_stats analysis.'
            },
            type: {
                type: 'string',
                enum: ['uuid', 'hex', 'alphanumeric', 'number'],
                description: 'Format type for uuid_random (default "uuid").'
            },
            length: {
                type: 'number',
                description: 'Length for random token generation or bounds for random numbers.'
            }
        },
        required: ['action']
    };

    /**
     * Returns the OpenAI-compatible function declaration schema for utility operations.
     */
    public getFunctionDeclaration(): FunctionDeclaration {
        return {
            type: 'function',
            function: {
                name: this.name,
                description: this.description,
                parameters: this.parameterSchema
            }
        };
    }

    /**
     * Executes the requested utility action.
     * @param args Tool arguments.
     * @param context Execution context.
     * @returns Result string of the operation.
     */
    public async execute(args: any, _context?: ToolContext): Promise<string> {
        const action = args.action;

        switch (action) {
            case 'get_time': {
                const now = new Date();
                const localeDate = now.toLocaleString();
                const isoDate = now.toISOString();
                const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
                const dayOfWeek = now.toLocaleDateString(undefined, { weekday: 'long' });
                return JSON.stringify({
                    local_datetime: localeDate,
                    iso_timestamp: isoDate,
                    day_of_week: dayOfWeek,
                    timezone: timeZone,
                    timestamp_ms: now.getTime()
                }, null, 2);
            }

            case 'calculate': {
                const expr = args.expression;
                if (!expr || typeof expr !== 'string') {
                    return '[Error]: "expression" string is required for calculate action.';
                }
                try {
                    // Sanitize expression: allow only numbers, basic operators, parenthesis, and safe Math functions
                    const sanitized = expr.replace(/[^0-9+\-*/().,%^ Math.PIEabscqrtlonegxpfdijukv]/g, '');
                    // Evaluate using safe Function scope
                    const safeEval = new Function('Math', `"use strict"; return (${sanitized});`);
                    const result = safeEval(Math);
                    return `Result of (${expr}) = ${result}`;
                } catch (e: any) {
                    return `[Calculation Error]: ${e.message || 'Invalid mathematical expression'}`;
                }
            }

            case 'unit_converter': {
                const val = Number(args.value);
                if (isNaN(val)) {
                    return '[Error]: Numerical "value" is required for unit_converter.';
                }
                const from = (args.from_unit || '').toLowerCase().trim();
                const to = (args.to_unit || '').toLowerCase().trim();

                const res = this.convertUnits(val, from, to);
                return res;
            }

            case 'text_stats': {
                const str = args.text || '';
                const charCountWithSpaces = str.length;
                const charCountNoSpaces = str.replace(/\s/g, '').length;
                const words = str.trim() ? str.trim().split(/\s+/).length : 0;
                const lines = str ? str.split(/\r\n|\r|\n/).length : 0;
                const estTokens = Math.ceil(charCountWithSpaces / 4);
                const estReadingTimeMinutes = (words / 200).toFixed(2);

                return JSON.stringify({
                    words,
                    characters_with_spaces: charCountWithSpaces,
                    characters_without_spaces: charCountNoSpaces,
                    lines,
                    estimated_tokens: estTokens,
                    estimated_reading_time_minutes: estReadingTimeMinutes
                }, null, 2);
            }

            case 'uuid_random': {
                const type = args.type || 'uuid';
                if (type === 'uuid') {
                    return `Generated UUID: ${this.generateUuid()}`;
                } else if (type === 'hex') {
                    const len = Math.max(4, Math.min(Number(args.length) || 16, 128));
                    let hex = '';
                    while (hex.length < len) {
                        hex += Math.random().toString(16).substring(2);
                    }
                    return `Generated Hex: ${hex.substring(0, len)}`;
                } else if (type === 'alphanumeric') {
                    const len = Math.max(4, Math.min(Number(args.length) || 16, 128));
                    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
                    let token = '';
                    for (let i = 0; i < len; i++) {
                        token += chars.charAt(Math.floor(Math.random() * chars.length));
                    }
                    return `Generated Token: ${token}`;
                } else if (type === 'number') {
                    const max = Number(args.length) || 100;
                    return `Random Number (1-${max}): ${Math.floor(Math.random() * max) + 1}`;
                }
                return `Generated UUID: ${this.generateUuid()}`;
            }

            default:
                return `[Error]: Unknown action "${action}". Valid actions: get_time, calculate, unit_converter, text_stats, uuid_random.`;
        }
    }

    /**
     * Converts values between supported units.
     */
    private convertUnits(val: number, from: string, to: string): string {
        // Temperature
        if ((from === 'c' || from === 'celsius') && (to === 'f' || to === 'fahrenheit')) {
            return `${val}°C = ${(val * 9/5 + 32).toFixed(2)}°F`;
        }
        if ((from === 'f' || from === 'fahrenheit') && (to === 'c' || to === 'celsius')) {
            return `${val}°F = ${((val - 32) * 5/9).toFixed(2)}°C`;
        }
        if ((from === 'c' || from === 'celsius') && (to === 'k' || to === 'kelvin')) {
            return `${val}°C = ${(val + 273.15).toFixed(2)} K`;
        }

        // Distance & Length
        const lengthToMeters: Record<string, number> = {
            m: 1, meter: 1, meters: 1,
            km: 1000, kilometer: 1000, kilometers: 1000,
            cm: 0.01, centimeter: 0.01,
            mm: 0.001, millimeter: 0.001,
            mi: 1609.344, mile: 1609.344, miles: 1609.344,
            ft: 0.3048, foot: 0.3048, feet: 0.3048,
            in: 0.0254, inch: 0.0254, inches: 0.0254,
            yd: 0.9144, yard: 0.9144, yards: 0.9144
        };

        if (lengthToMeters[from] && lengthToMeters[to]) {
            const inMeters = val * lengthToMeters[from];
            const converted = inMeters / lengthToMeters[to];
            return `${val} ${from} = ${converted.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${to}`;
        }

        // Weight & Mass
        const weightToGrams: Record<string, number> = {
            g: 1, gram: 1, grams: 1,
            kg: 1000, kilogram: 1000, kilograms: 1000,
            mg: 0.001, milligram: 0.001,
            lbs: 453.59237, lb: 453.59237, pound: 453.59237, pounds: 453.59237,
            oz: 28.3495, ounce: 28.3495, ounces: 28.3495
        };

        if (weightToGrams[from] && weightToGrams[to]) {
            const inGrams = val * weightToGrams[from];
            const converted = inGrams / weightToGrams[to];
            return `${val} ${from} = ${converted.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${to}`;
        }

        // Digital Data Storage
        const dataToBytes: Record<string, number> = {
            b: 1, byte: 1, bytes: 1,
            kb: 1024,
            mb: 1024 * 1024,
            gb: 1024 * 1024 * 1024,
            tb: 1024 * 1024 * 1024 * 1024
        };

        if (dataToBytes[from] && dataToBytes[to]) {
            const inBytes = val * dataToBytes[from];
            const converted = inBytes / dataToBytes[to];
            return `${val} ${from.toUpperCase()} = ${converted.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${to.toUpperCase()}`;
        }

        return `[Unit Converter]: Conversion from "${from}" to "${to}" is not supported.`;
    }

    /**
     * Generates a standard UUID v4 string.
     */
    private generateUuid(): string {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }
}
