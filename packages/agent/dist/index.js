export class PalmosAgentClientError extends Error {
    status;
    payload;
    constructor(message, status, payload) {
        super(message);
        this.status = status;
        this.payload = payload;
        this.name = 'PalmosAgentClientError';
    }
}
function trimTrailingSlash(value) {
    return value.endsWith('/') ? value.slice(0, -1) : value;
}
function readDefaultEnv() {
    const scope = globalThis;
    return scope.process?.env ?? {};
}
async function parseJsonResponse(response) {
    const text = await response.text();
    if (!text) {
        return null;
    }
    try {
        return JSON.parse(text);
    }
    catch {
        return text;
    }
}
function readErrorMessage(payload, fallback) {
    if (payload && typeof payload === 'object' && 'error' in payload) {
        const error = payload.error;
        if (typeof error === 'string' && error.trim()) {
            return error;
        }
    }
    return fallback;
}
export class PalmosAgentClient {
    baseUrl;
    token;
    fetchImpl;
    constructor(config) {
        if (!config.token.trim()) {
            throw new Error('PalmOS agent token is required.');
        }
        this.baseUrl = trimTrailingSlash(config.baseUrl ?? 'http://127.0.0.1:4030');
        this.token = config.token.trim();
        this.fetchImpl = config.fetchImpl ?? fetch;
    }
    static fromEnv(env = readDefaultEnv()) {
        const token = env.PALMOS_AGENT_TOKEN?.trim();
        if (!token) {
            throw new Error('Set PALMOS_AGENT_TOKEN to an issued palmos_... SDK token.');
        }
        return new PalmosAgentClient({
            baseUrl: env.PALMOS_API_URL?.trim(),
            token,
        });
    }
    async me() {
        return this.request('/api/sdk/v1/me');
    }
    async listServices() {
        return this.request('/api/sdk/v1/services');
    }
    async pay(input) {
        return this.request('/api/sdk/v1/pay', {
            method: 'POST',
            body: JSON.stringify({
                serviceId: input.serviceId,
                request: input.request ?? {},
                amount: input.amount,
                note: input.note,
            }),
        });
    }
    async request(path, init = {}) {
        const headers = new Headers(init.headers);
        headers.set('authorization', `Bearer ${this.token}`);
        headers.set('content-type', headers.get('content-type') ?? 'application/json');
        const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
            ...init,
            headers,
        });
        const payload = await parseJsonResponse(response);
        if (!response.ok) {
            throw new PalmosAgentClientError(readErrorMessage(payload, `PalmOS SDK request failed with ${response.status}.`), response.status, payload);
        }
        return payload;
    }
}
//# sourceMappingURL=index.js.map