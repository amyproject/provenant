// Typed client for every route in src/contracts/api.ts.
// NEXT_PUBLIC_USE_MOCKS=1 swaps in an in-browser mock backend (src/lib/client/mocks.ts) so the UI
// can be built and demoed before the real routes exist.
import type {
  AgentCase,
  AgentEventsResponse,
  AgentOutboxResponse,
  AgentStepResponse,
  AgentTickResponse,
  ApiError,
  AutopilotStatus,
  BuyerPolicy,
  CreatePassportRequest,
  CreatePassportResponse,
  CreatePurchaseOrderRequest,
  CreatePurchaseOrderResponse,
  DemoRunResponse,
  EnrollSupplierRequest,
  EnrollSupplierResponse,
  IntegrationStatus,
  ListSuppliersResponse,
  OverrideRequest,
  PartPassport,
  PolicyResponse,
  PurchaseOrderDetail,
  SupplierDetailResponse,
  TamperRequest,
  TamperResponse,
  UploadDocumentRequest,
  UploadDocumentResponse,
  VerifyResponse,
} from "@/contracts";
import { ApiClientError } from "./errors";

export interface Api {
  // Suppliers
  listSuppliers(): Promise<ListSuppliersResponse>;
  getSupplier(id: string): Promise<SupplierDetailResponse>;
  enrollSupplier(req: EnrollSupplierRequest): Promise<EnrollSupplierResponse>;
  uploadDocument(supplierId: string, req: UploadDocumentRequest): Promise<UploadDocumentResponse>;
  // Passports
  createPassport(req: CreatePassportRequest): Promise<CreatePassportResponse>;
  getPassport(id: string): Promise<PartPassport>;
  revokePassport(id: string): Promise<PartPassport>;
  verify(jwt: string): Promise<VerifyResponse>;
  // Purchase orders
  listPurchaseOrders(): Promise<PurchaseOrderDetail[]>;
  getPurchaseOrder(id: string): Promise<PurchaseOrderDetail>;
  createPurchaseOrder(req: CreatePurchaseOrderRequest): Promise<CreatePurchaseOrderResponse>;
  /** Response body is not specified by the contract; callers should refetch the PO. */
  overridePurchaseOrder(id: string, req: OverrideRequest): Promise<unknown>;
  // Autonomous agent
  listCases(): Promise<AgentCase[]>;
  stepCase(id: string): Promise<AgentStepResponse>;
  runCase(id: string): Promise<AgentStepResponse>;
  tick(): Promise<AgentTickResponse>;
  caseEvents(id: string, after?: string): Promise<AgentEventsResponse>;
  /** All cases, oldest → newest. */
  listEvents(after?: string, limit?: number): Promise<AgentEventsResponse>;
  outbox(): Promise<AgentOutboxResponse>;
  getAutopilot(): Promise<AutopilotStatus>;
  setAutopilot(enabled: boolean): Promise<AutopilotStatus>;
  // Demo
  resetDemo(): Promise<{ ok: true }>;
  runDemo(): Promise<DemoRunResponse>;
  tamper(req: TamperRequest): Promise<TamperResponse>;
  /** Restores one passport's original signed JWT after a tamper demo. */
  restorePassport(passportId: string): Promise<PartPassport>;
  // Policy + integrations
  getPolicy(): Promise<PolicyResponse>;
  putPolicy(policy: BuyerPolicy): Promise<PolicyResponse>;
  integrationStatus(): Promise<IntegrationStatus>;
}

export { ApiClientError };

// Mutating routes need `x-demo-token` when the server sets DEMO_ADMIN_TOKEN (public deploys).
// The operator types it once; it is kept in localStorage for this browser only.
export const DEMO_TOKEN_KEY = "provenant-demo-token";

/** Every non-GET call may be guarded by DEMO_ADMIN_TOKEN. */
function needsDemoToken(method: string) {
  return method !== "GET";
}

function demoToken(): string | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage.getItem(DEMO_TOKEN_KEY);
  } catch {
    return null;
  }
}

async function send(method: string, path: string, body: unknown, token: string | null): Promise<Response> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (token && needsDemoToken(method)) headers["x-demo-token"] = token;
  try {
    return await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
  } catch (e) {
    throw new ApiClientError(0, `Network error calling ${method} ${path}: ${(e as Error).message}`);
  }
}

async function request<T>(method: "GET" | "POST" | "PUT", path: string, body?: unknown): Promise<T> {
  let res = await send(method, path, body, demoToken());
  if ((res.status === 401 || res.status === 403) && needsDemoToken(method) && typeof window !== "undefined") {
    const entered = window.prompt("This deployment protects demo controls. Enter the demo token:");
    if (entered) {
      try {
        window.localStorage.setItem(DEMO_TOKEN_KEY, entered);
      } catch {
        /* storage unavailable: use the token for this request only */
      }
      res = await send(method, path, body, entered);
    }
  }
  const text = await res.text();
  let json: unknown = undefined;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
  }
  if (!res.ok) {
    const err = json as Partial<ApiError> | undefined;
    throw new ApiClientError(
      res.status,
      err?.error ?? `${method} ${path} failed with ${res.status}`,
      err?.details,
    );
  }
  return json as T;
}

const enc = encodeURIComponent;

export const httpApi: Api = {
  listSuppliers: () => request("GET", "/api/suppliers"),
  getSupplier: (id) => request("GET", `/api/suppliers/${enc(id)}`),
  enrollSupplier: (req) => request("POST", "/api/suppliers", req),
  uploadDocument: (supplierId, req) =>
    request("POST", `/api/suppliers/${enc(supplierId)}/documents`, req),

  createPassport: (req) => request("POST", "/api/passports", req),
  getPassport: (id) => request("GET", `/api/passports/${enc(id)}`),
  revokePassport: (id) => request("POST", `/api/passports/${enc(id)}/revoke`),
  verify: (jwt) => request("POST", "/api/verify", { jwt }),

  listPurchaseOrders: () => request("GET", "/api/purchase-orders"),
  getPurchaseOrder: (id) => request("GET", `/api/purchase-orders/${enc(id)}`),
  createPurchaseOrder: (req) => request("POST", "/api/purchase-orders", req),
  overridePurchaseOrder: (id, req) =>
    request("POST", `/api/purchase-orders/${enc(id)}/override`, req),

  listCases: () => request("GET", "/api/agent/cases"),
  stepCase: (id) => request("POST", `/api/agent/cases/${enc(id)}/step`),
  runCase: (id) => request("POST", `/api/agent/cases/${enc(id)}/run`),
  tick: () => request("POST", "/api/agent/tick"),
  caseEvents: (id, after) =>
    request(
      "GET",
      `/api/agent/cases/${enc(id)}/events${after ? `?after=${enc(after)}` : ""}`,
    ),
  listEvents: (after, limit) => {
    const q = new URLSearchParams();
    if (after) q.set("after", after);
    if (limit) q.set("limit", String(limit));
    const qs = q.toString();
    return request("GET", `/api/agent/events${qs ? `?${qs}` : ""}`);
  },
  outbox: () => request("GET", "/api/agent/outbox"),
  getAutopilot: () => request("GET", "/api/agent/autopilot"),
  setAutopilot: (enabled) => request("POST", "/api/agent/autopilot", { enabled }),

  resetDemo: () => request("POST", "/api/demo/reset"),
  runDemo: () => request("POST", "/api/demo/run"),
  tamper: (req) => request("POST", "/api/demo/tamper", req),
  restorePassport: (passportId) => request("POST", "/api/demo/restore-passport", { passportId }),

  getPolicy: () => request("GET", "/api/policy"),
  putPolicy: (policy) => request("PUT", "/api/policy", policy),
  integrationStatus: () => request("GET", "/api/integrations/status"),
};

export const USE_MOCKS = process.env.NEXT_PUBLIC_USE_MOCKS === "1";

// The mock backend (and its heartbeat interval) is only loaded when mocks are on, so it never
// runs in a real deployment.
let mocks: Promise<Api> | null = null;
const loadMocks = () => (mocks ??= import("./mocks").then((m) => m.mockApi));

const lazyMockApi = new Proxy({} as Api, {
  get: (_target, prop) =>
    (...args: unknown[]) =>
      loadMocks().then((m) => (m[prop as keyof Api] as (...a: unknown[]) => Promise<unknown>)(...args)),
});

export const api: Api = USE_MOCKS ? lazyMockApi : httpApi;

export function errorMessage(e: unknown): string {
  if (e instanceof ApiClientError) {
    return e.status === 404 ? `Not found (${e.message})` : e.message;
  }
  return e instanceof Error ? e.message : String(e);
}
