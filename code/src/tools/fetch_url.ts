import * as http from 'http';
import * as https from 'https';
import * as dns from 'dns';
import * as net from 'net';
import { Tool, ToolContext, FunctionDeclaration } from './Tool';

const MAX_REDIRECTS = 3;
const MAX_FETCH_BYTES = 1024 * 1024;

/**
 * Checks whether an IP address belongs to loopback, private, link-local, or unspecified ranges.
 */
function isBlockedIpAddress(ip: string): boolean {
    const clean = ip.replace(/^\[|\]$/g, '').toLowerCase();
    const mappedV4 = clean.startsWith('::ffff:') ? clean.slice(7) : clean;
    if (net.isIPv4(mappedV4)) {
        const parts = mappedV4.split('.').map(Number);
        const [a, b] = parts;
        if (a === 0 || a === 10 || a === 127) return true;
        if (a === 169 && b === 254) return true;
        if (a === 172 && b >= 16 && b <= 31) return true;
        if (a === 192 && b === 168) return true;
        if (a === 100 && b >= 64 && b <= 127) return true;
        return false;
    }
    if (net.isIPv6(clean)) {
        if (clean === '::' || clean === '::1') return true;
        if (clean.startsWith('fc') || clean.startsWith('fd')) return true;
        if (clean.startsWith('fe8') || clean.startsWith('fe9') || clean.startsWith('fea') || clean.startsWith('feb')) return true;
        return false;
    }
    return true;
}

/**
 * Validates that a URL targets a public HTTP/HTTPS endpoint and not local/private infrastructure.
 */
async function validatePublicUrl(rawUrl: string): Promise<URL> {
    const parsedUrl = new URL(rawUrl);
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        throw new Error('Error: Invalid URL. Must start with http:// or https://');
    }
    const hostname = parsedUrl.hostname.toLowerCase();
    if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
        throw new Error('SSRF protection: Access to localhost addresses is blocked.');
    }
    if (net.isIP(hostname)) {
        if (isBlockedIpAddress(hostname)) {
            throw new Error(`SSRF protection: Access to private or reserved IP "${hostname}" is blocked.`);
        }
        return parsedUrl;
    }
    const records = await dns.promises.lookup(hostname, { all: true });
    if (!records || records.length === 0) {
        throw new Error(`DNS resolution failed for host "${hostname}".`);
    }
    for (const rec of records) {
        if (isBlockedIpAddress(rec.address)) {
            throw new Error(`SSRF protection: Host "${hostname}" resolved to blocked IP "${rec.address}".`);
        }
    }
    return parsedUrl;
}

/**
 * Tool for fetching web page or raw API documentation content from a HTTP/HTTPS URL.
 */
export class FetchUrlTool extends Tool {
    public readonly name = 'fetch_url';
    public readonly description = 'Fetches raw text content from a web URL for documentation or reference.';
    protected readonly maxOutputLines = 60;
    protected readonly maxOutputBytes = 4000;

    public getFunctionDeclaration(): FunctionDeclaration {
        return {
            type: 'function',
            function: {
                name: this.name,
                description: this.description,
                parameters: {
                    type: 'object',
                    properties: {
                        url: {
                            type: 'string',
                            description: 'Full HTTP or HTTPS URL to fetch.'
                        }
                    },
                    required: ['url']
                }
            }
        };
    }

    /**
     * Executes the URL fetch operation.
     * @param args Arguments containing target URL.
     * @param _context Execution context.
     * @returns Raw response text.
     */
    public async execute(args: { url: string }, _context: ToolContext, redirectCount: number = 0): Promise<string> {
        if (!args.url || (!args.url.startsWith('http://') && !args.url.startsWith('https://'))) {
            return 'Error: Invalid URL. Must start with http:// or https://';
        }
        if (redirectCount > MAX_REDIRECTS) {
            return `Fetch error: Exceeded maximum redirect limit (${MAX_REDIRECTS}).`;
        }

        let parsedUrl: URL;
        try {
            parsedUrl = await validatePublicUrl(args.url);
        } catch (err: any) {
            return err.message || String(err);
        }

        return new Promise((resolve) => {
            try {
                const clientModule = parsedUrl.protocol === 'https:' ? https : http;

                const req = clientModule.get(parsedUrl.toString(), { timeout: 8000 }, (res) => {
                    if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                        res.resume();
                        try {
                            const nextUrl = new URL(res.headers.location, parsedUrl).toString();
                            this.execute({ url: nextUrl }, _context, redirectCount + 1).then(resolve);
                        } catch {
                            resolve('Fetch error: Invalid redirect URL.');
                        }
                        return;
                    }

                    const chunks: Buffer[] = [];
                    let totalBytes = 0;
                    let truncatedAtCap = false;

                    res.on('data', (chunk: Buffer) => {
                        totalBytes += chunk.length;
                        if (totalBytes > MAX_FETCH_BYTES) {
                            const remaining = MAX_FETCH_BYTES - (totalBytes - chunk.length);
                            if (remaining > 0) chunks.push(chunk.subarray(0, remaining));
                            truncatedAtCap = true;
                            req.destroy();
                            return;
                        }
                        chunks.push(chunk);
                    });
                    res.on('end', () => {
                        const data = Buffer.concat(chunks).toString('utf8');
                        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                            // Strip HTML tags if HTML page
                            let cleanText = data;
                            if (res.headers['content-type']?.includes('html')) {
                                cleanText = data.replace(/<script\b[^<]*>([\s\S]*?)<\/script>/gi, '')
                                                .replace(/<style\b[^<]*>([\s\S]*?)<\/style>/gi, '')
                                                .replace(/<[^>]+>/g, ' ')
                                                .replace(/\s+/g, ' ');
                            }
                            const suffix = truncatedAtCap ? '\n... [Response capped at 1MB]' : '';
                            resolve(this.truncateOutput(cleanText.trim() + suffix));
                        } else {
                            resolve(`HTTP Error ${res.statusCode}: Failed to fetch URL.`);
                        }
                    });
                });

                req.on('error', (err) => {
                    if (!req.destroyed) resolve(`Fetch error: ${err.message}`);
                });
                req.on('timeout', () => { req.destroy(); resolve('Fetch error: Connection timed out after 8s'); });
            } catch (e: any) {
                resolve(`URL parsing error: ${e.message || e}`);
            }
        });
    }
}
