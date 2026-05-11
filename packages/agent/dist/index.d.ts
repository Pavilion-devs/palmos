export type PalmosAgentClientConfig = {
    baseUrl?: string;
    token: string;
    fetchImpl?: typeof fetch;
};
export type PalmosSdkCredential = {
    credentialId: string;
    agentId: string;
    label: string;
    keyPrefix: string;
    status: string;
    createdAt?: string;
    updatedAt?: string;
    lastUsedAt?: string;
};
export type PalmosSdkAgent = {
    agentId: string;
    displayName: string;
    organizationId: string;
    treasuryId?: string;
    environment: string;
    status: string;
    walletType: string;
    settlementMode?: 'local-demo' | 'ows' | 'real-solana';
    walletId?: string;
    walletState?: string;
    walletBackend?: string;
    owsWalletId?: string;
    owsWalletName?: string;
    policyConfig?: unknown;
};
export type PalmosSdkService = {
    serviceId: string;
    label: string;
    vendorId: string;
    chainId: string;
    assetSymbol: string;
    expectedAmount: string;
    paymentRail: string;
    allowed: boolean;
};
export type PalmosSdkPayInput = {
    serviceId: string;
    request?: Record<string, unknown>;
    amount?: string;
    note?: string;
};
export type PalmosSdkMeResponse = {
    ok: true;
    agent: PalmosSdkAgent;
    credential: PalmosSdkCredential;
};
export type PalmosSdkServicesResponse = {
    ok: true;
    agentId: string;
    services: PalmosSdkService[];
};
export type PalmosSdkPayResponse = {
    ok: true;
    agentId: string;
    credentialId: string;
    result: unknown;
};
export declare class PalmosAgentClientError extends Error {
    readonly status: number;
    readonly payload: unknown;
    constructor(message: string, status: number, payload: unknown);
}
export declare class PalmosAgentClient {
    private readonly baseUrl;
    private readonly token;
    private readonly fetchImpl;
    constructor(config: PalmosAgentClientConfig);
    static fromEnv(env?: Record<string, string | undefined>): PalmosAgentClient;
    me(): Promise<PalmosSdkMeResponse>;
    listServices(): Promise<PalmosSdkServicesResponse>;
    pay(input: PalmosSdkPayInput): Promise<PalmosSdkPayResponse>;
    private request;
}
//# sourceMappingURL=index.d.ts.map