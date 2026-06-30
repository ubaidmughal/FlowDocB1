import axios, { AxiosInstance } from 'axios';
import { config } from '../config';

// ── FlowDoc API Response Types ──────────────────────────────────────────────

export interface ClaimItem {
  queue_id: string;
  invoice_id: string;
  attempts: number;
  ncf: string;
  ncf_type: string;
  fecha_emision: string;
  subtotal: number;
  descuento: number;
  impuesto: number;
  propina_legal: number;
  propina_adicional: number;
  isc: number;
  otros_cargos: number;
  total: number;
  moneda: string;
  tasa_cambio: number | null;
  codigo_seguridad: string;
  observaciones: string | null;
  gl_account: string;
  cost_center: string;
  vendor_rnc: string;
  vendor_nombre: string;
  vendor_erp_card_code: string | null;
  vendor_email: string;
  vendor_telefono: string;
}

export interface ClaimResponse {
  batchId: string;
  total: number;
  items: ClaimItem[];
}

export interface WebhookResultItem {
  invoiceId: string;
  success: boolean;
  erpDocId?: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface WebhookRequest {
  batchId: string;
  results: WebhookResultItem[];
}

export interface WebhookResponse {
  processed: number;
  errors: number;
  total: number;
}

// ── FlowDocClient ───────────────────────────────────────────────────────────

export class FlowDocClient {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: config.flowdoc.baseUrl,
      headers: {
        Authorization: `Bearer ${config.flowdoc.apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 30_000,
    });
  }

  /**
   * Atomically claims queued invoices from FlowDoc for processing.
   * Marks them as 'syncing' to prevent duplicate pick-up.
   */
  async claim(limit: number = 10): Promise<ClaimResponse> {
    const response = await this.client.post<ClaimResponse>(
      '/api/erp/sync/claim',
      { limit }
    );
    return response.data;
  }

  /**
   * Reports sync results back to FlowDoc after processing.
   */
  async reportWebhook(payload: WebhookRequest): Promise<WebhookResponse> {
    const response = await this.client.post<WebhookResponse>(
      '/api/erp/webhook',
      payload
    );
    return response.data;
  }

  /**
   * Fetches full invoice detail from FlowDoc, including line items,
   * documents, status history, and DGII validation.
   */
  async getInvoiceDetail(invoiceId: string): Promise<any> {
    const response = await this.client.get(`/api/invoices/${invoiceId}`);
    return response.data;
  }
}

/** Shared singleton instance */
export const flowDocClient = new FlowDocClient();
