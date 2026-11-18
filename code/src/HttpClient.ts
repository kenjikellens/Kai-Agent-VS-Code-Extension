import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';

/**
 * Reusable HTTP and HTTPS client utility providing promise-based JSON requests
 * and Server-Sent Events (SSE) stream parsing with strict timeout enforcement.
 */
const MAX_JSON_RESPONSE_BYTES = 10 * 1024 * 1024;
const MAX_ERROR_BODY_BYTES = 256 * 1024;

export class HttpClient {
    /**
     * Executes an HTTP or HTTPS GET request and parses the JSON response body.
     * @param urlStr Target API URL string.
     * @param headers Optional request headers.
     * @param timeoutMs Request timeout in milliseconds (default: 3000ms).
     * @returns Promise resolving to the parsed JSON response object.
     */
    public static async getJson<T>(urlStr: string, headers: Record<string, string> = {}, timeoutMs: number = 3000): Promise<T> {
        return new Promise((resolve, reject) => {
            try {
                const parsedUrl = new URL(urlStr);
                const clientModule = parsedUrl.protocol === 'https:' ? https : http;
                const options: http.RequestOptions = {
                    hostname: parsedUrl.hostname,
                    port: parsedUrl.port ? parseInt(parsedUrl.port, 10) : (parsedUrl.protocol === 'https:' ? 443 : 80),
                    path: parsedUrl.pathname + parsedUrl.search,
                    method: 'GET',
                    timeout: timeoutMs,
                    headers: headers
                };

                const req = clientModule.request(options, (res) => {
                    const chunks: Buffer[] = [];
                    let totalBytes = 0;
                    res.on('data', (chunk: Buffer) => {
                        totalBytes += chunk.length;
                        if (totalBytes > MAX_JSON_RESPONSE_BYTES) {
                            req.destroy();
                            reject(new Error(`Response exceeded ${MAX_JSON_RESPONSE_BYTES} byte limit from ${urlStr}`));
                            return;
                        }
                        chunks.push(chunk);
                    });
                    res.on('end', () => {
                        const data = Buffer.concat(chunks).toString('utf8');
                        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                            try {
                                resolve(JSON.parse(data) as T);
                            } catch (err) {
                                reject(new Error(`Failed to parse JSON response from ${urlStr}`));
                            }
                        } else {
                            reject(new Error(`HTTP status ${res.statusCode} from ${urlStr}`));
                        }
                    });
                });

                req.on('error', (err) => reject(err));
                req.on('timeout', () => {
                    req.destroy();
                    reject(new Error(`Request timeout (${timeoutMs}ms) for ${urlStr}`));
                });

                req.end();
            } catch (err) {
                reject(err);
            }
        });
    }

    /**
     * Executes a POST request to an SSE streaming endpoint and processes data chunks.
     * @param urlStr Target API URL string.
     * @param payload JSON request payload string.
     * @param headers HTTP headers object.
     * @param onChunk Callback invoked for each received stream data chunk.
     * @param signal Optional AbortSignal for request cancellation.
     * @param timeoutMs Connection timeout in milliseconds.
     * @returns Promise resolving when the stream completes.
     */
    public static async postSse(
        urlStr: string,
        payload: string,
        headers: Record<string, string>,
        onChunk: (chunk: string) => void,
        signal?: any,
        timeoutMs?: number
    ): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                const parsedUrl = new URL(urlStr);
                const clientModule = parsedUrl.protocol === 'https:' ? https : http;
                const options: http.RequestOptions = {
                    hostname: parsedUrl.hostname,
                    port: parsedUrl.port ? parseInt(parsedUrl.port, 10) : (parsedUrl.protocol === 'https:' ? 443 : 80),
                    path: parsedUrl.pathname + parsedUrl.search,
                    method: 'POST',
                    signal: signal,
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(payload),
                        ...headers
                    }
                };

                if (timeoutMs) {
                    options.timeout = timeoutMs;
                }

                const req = clientModule.request(options, (res) => {
                    if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
                        let errBody = '';
                        res.on('data', (d) => {
                            if (errBody.length < MAX_ERROR_BODY_BYTES) errBody += d.toString();
                        });
                        res.on('end', () => {
                            try {
                                const parsed = JSON.parse(errBody);
                                reject(new Error(parsed.error?.message || `HTTP ${res.statusCode}`));
                            } catch {
                                reject(new Error(`HTTP status ${res.statusCode}`));
                            }
                        });
                        return;
                    }

                    res.on('data', (chunk) => {
                        onChunk(chunk.toString());
                    });

                    res.on('end', () => {
                        resolve();
                    });
                });

                req.on('error', (err) => reject(err));
                if (timeoutMs) {
                    req.on('timeout', () => {
                        req.destroy();
                        reject(new Error(`Stream connection timed out (${timeoutMs}ms)`));
                    });
                }

                req.write(payload);
                req.end();
            } catch (err) {
                reject(err);
            }
        });
    }
}
