import axios, { AxiosInstance } from 'axios';
import https from 'https';
import { config } from '../config';

// ── SAP B1 Types ────────────────────────────────────────────────────────────

export interface SapSession {
  sessionId: string;
  sessionTimeout: number;
  version: string;
}

export interface BusinessPartner {
  CardCode: string;
  CardName: string;
  CardType: string;
  FederalTaxID: string;
  //LicTradNum: string;
  Currency: string;
}

export interface SapErrorResponse {
  error?: {
    code: number;
    message: { lang: string; value: string };
  };
}

// ── SapB1Client ─────────────────────────────────────────────────────────────

export class SapB1Client {
  private createClient(): AxiosInstance {
    const httpsAgent = new https.Agent({
      rejectUnauthorized: config.sapB1.tlsRejectUnauthorized !== false,
    });

    return axios.create({
      baseURL: config.sapB1.baseUrl,
      httpsAgent,
      timeout: 30_000,
    });
  }

  /**
   * Logs into SAP B1 Service Layer and returns a session.
   */
  async login(): Promise<string> {
    const client = this.createClient();
    console.log(`[SAP] Logging into ${config.sapB1.baseUrl}/Login (DB: ${config.sapB1.companyDb}, TLS verify: ${config.sapB1.tlsRejectUnauthorized})`);
    try {
      const response = await client.post<{ SessionId: string; Version: string; SessionTimeout: number }>(
        '/Login',
        {
          CompanyDB: config.sapB1.companyDb,
          UserName: config.sapB1.username,
          Password: config.sapB1.password,
        }
      );
      console.log(`[SAP] Login OK — SessionId: ${response.data.SessionId.substring(0, 12)}...`);
      return response.data.SessionId;
    } catch (err: any) {
      const status = err.response?.status;
      const msg = err.response?.data?.error?.message?.value || err.message;
      console.error(`[SAP] Login FAILED (HTTP ${status || 'N/A'}): ${msg}`);
      if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND' || err.code === 'ECONNRESET') {
        console.error(`[SAP] Connection error — is the SAP server reachable at ${config.sapB1.baseUrl}?`);
      }
      throw err;
    }
  }

  /**
   * Logs out of SAP B1 Service Layer.
   */
  async logout(sessionId: string): Promise<void> {
    const client = this.createClient();
    await client.post('/Logout', null, {
      headers: { Cookie: `B1SESSION=${sessionId}; ROUTEID=.node0` },
    });
  }

  /**
   * Performs an authenticated GET request to SAP Service Layer.
   */
  private async get(path: string, sessionId: string): Promise<any> {
    const client = this.createClient();
    const response = await client.get(path, {
      headers: { Cookie: `B1SESSION=${sessionId}; ROUTEID=.node0` },
    });
    return response.data;
  }

  /**
   * Performs an authenticated POST request to SAP Service Layer.
   */
  private async post(path: string, body: any, sessionId: string): Promise<any> {
    const client = this.createClient();
    const response = await client.post(path, body, {
      headers: {
        Cookie: `B1SESSION=${sessionId}; ROUTEID=.node0`,
        'Content-Type': 'application/json',
      },
    });
    return response.data;
  }

  /**
   * Performs an authenticated PATCH request to SAP Service Layer.
   */
  private async patch(path: string, body: any, sessionId: string): Promise<any> {
    const client = this.createClient();
    const response = await client.patch(path, body, {
      headers: {
        Cookie: `B1SESSION=${sessionId}; ROUTEID=.node0`,
        'Content-Type': 'application/json',
      },
    });
    return response.data;
  }

  /**
   * Finds a vendor (BusinessPartner) by RNC using FederalTaxID.
   * SAP Service Layer FederalTaxID ↔ SAP DB OCRD.LicTradNum ↔ FlowDoc RNC
   * Returns the CardCode if found, null otherwise.
   */
  async findVendorByRnc(rnc: string, sessionId: string): Promise<BusinessPartner | null> {
    const cleanRnc = rnc.replace(/\D/g, '');
    const encodedRnc = encodeURIComponent(cleanRnc);
    console.log(`[SAP] Searching vendor by FederalTaxID (OCRD.LicTradNum): ${cleanRnc}`);
    const data = await this.get(
      `/BusinessPartners?$filter=FederalTaxID eq '${encodedRnc}' and CardType eq 'cSupplier'&$top=1`,
      sessionId
    );

    if (data.value && data.value.length > 0) {
      const bp = data.value[0] as BusinessPartner;
      console.log(`[SAP] Vendor found — CardCode: ${bp.CardCode}, Name: ${bp.CardName}`);
      return bp;
    }
    console.log(`[SAP] Vendor not found by FederalTaxID: ${cleanRnc}`);
    return null;
  }

  /**
   * Creates a new vendor (BusinessPartner) in SAP B1.
   * CardCode is auto-generated as V{rnc}.
   * FederalTaxID (OCRD.LicTradNum) is set to the FlowDoc RNC for linking.
   */
  async createVendor(
    vendor: { rnc: string; nombre: string; email?: string; telefono?: string; direccion?: string },
    sessionId: string
  ): Promise<{ CardCode: string; CardName: string }> {
    // Strip non-numeric chars for clean SAP-friendly format
    const cleanRnc = vendor.rnc.replace(/\D/g, '');
    const cardCode = `V${cleanRnc}`;

    const payload = {
      CardCode: cardCode,
      CardName: vendor.nombre.substring(0, 100),
      CardType: 'cSupplier',
      FederalTaxID: cleanRnc,   // OCRD.LicTradNum
      Currency: '##', // all currencies
      EmailAddress: vendor.email || '',
      Phone1: vendor.telefono || '',
      Address: vendor.direccion || '',
    };

    console.log(`[SAP] Creating vendor — CardCode: ${cardCode}, RNC: ${cleanRnc}, Name: ${vendor.nombre}`);
    console.log(`[SAP] Payload:`, JSON.stringify(payload, null, 2));

    try {
      const data = await this.post('/BusinessPartners', payload, sessionId);
      console.log(`[SAP] Vendor created — CardCode: ${data.CardCode}, CardName: ${data.CardName}`);
      return {
        CardCode: data.CardCode || cardCode,
        CardName: data.CardName || vendor.nombre,
      };
    } catch (err: any) {
      const sapErr = err.response?.data?.error?.message?.value || err.message;
      console.error(`[SAP] Vendor creation FAILED for RNC ${cleanRnc}: ${sapErr}`);
      if (err.response?.data) {
        console.error(`[SAP] Full SAP response:`, JSON.stringify(err.response.data, null, 2));
      }
      throw err;
    }
  }

  /**
   * Checks if a Purchase Invoice with the given NCF already exists.
   * Link: SAP U_NCF = FlowDoc NCF
   */
  async checkDuplicateNcf(ncf: string, sessionId: string): Promise<boolean> {
    const encodedNcf = encodeURIComponent(ncf);
    console.log(`[SAP] Checking duplicate NCF: ${ncf}`);
    const data = await this.get(
      `/PurchaseInvoices?$filter=U_NCF eq '${encodedNcf}'&$top=1`,
      sessionId
    );
    const exists = data.value && data.value.length > 0;
    console.log(`[SAP] Duplicate NCF ${ncf}: ${exists ? 'FOUND' : 'not found'}`);
    return exists;
  }

  /**
   * Creates a Purchase Invoice in SAP B1 from FlowDoc invoice data.
   */
  async createPurchaseInvoice(
    invoice: {
      cardCode: string;
      ncf: string;
      ncfType: string;
      fechaEmision: string;
      moneda: string;
      tasaCambio: number | null;
      subtotal: number;
      descuento: number;
      impuesto: number;
      total: number;
      observaciones: string | null;
      glAccount: string | null;
      costCenter: string | null;
      lineItems: Array<{
        descripcion: string;
        cantidad: number;
        precio: number;
        itbisPct: number;
      }>;
    },
    sessionId: string
  ): Promise<{ DocEntry: number; DocNum: number }> {
    const dateStr = invoice.fechaEmision ? new Date(invoice.fechaEmision).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];

    const payload: any = {
      CardCode: invoice.cardCode,
      DocDate: dateStr,
      TaxDate: dateStr,
      DocDueDate: dateStr,
      DocType:'dDocument_Service',
      DocCurrency: invoice.moneda || 'USD',
      Comments: `NCF: ${invoice.ncf} | Processed by FlowDoc`,
      U_NCF: invoice.ncf,
      U_TipoNCF: invoice.ncfType,
      DocumentLines: (invoice.lineItems || []).map((item, idx) => ({
        ItemDescription: item.descripcion?.substring(0, 200) || 'Invoice line',
        Quantity: item.cantidad || 1,
        UnitPrice: (item.cantidad || 1) * (item.precio || 0),
        AccountCode: invoice.glAccount || '_SYS00000000105',
        CostingCode: invoice.costCenter || '',
        TaxCode: item.itbisPct > 0 ? 'ITBIS' : 'EXENTO',
      })),
    };

    // Exchange rate for foreign currency
    if (invoice.moneda !== 'DOP' && invoice.tasaCambio) {
      payload.DocRate = invoice.tasaCambio;
    }

    console.log(`[SAP] Creating Purchase Invoice — NCF: ${invoice.ncf}, CardCode: ${invoice.cardCode}`);
    console.log(`[SAP] Payload:`, JSON.stringify(payload, null, 2));

    try {
      const data = await this.post('/PurchaseInvoices', payload, sessionId);
      console.log(`[SAP] Purchase Invoice created — DocEntry: ${data.DocEntry}, DocNum: ${data.DocNum}`);
      return { DocEntry: data.DocEntry, DocNum: data.DocNum };
    } catch (err: any) {
      const sapErr = err.response?.data?.error?.message?.value || err.message;
      console.error(`[SAP] Purchase Invoice FAILED for NCF ${invoice.ncf}: ${sapErr}`);
      if (err.response?.data) {
        console.error(`[SAP] Full SAP response:`, JSON.stringify(err.response.data, null, 2));
      }
      throw err;
    }
  }

  /**
   * Attaches a document to a Purchase Invoice in SAP B1.
   * Step 1: Create attachment entry (metadata only).
   * Step 2: Upload raw file bytes via $value endpoint.
   */
  async attachDocument(
    docEntry: number,
    fileName: string,
    fileContentBase64: string,
    mimeType: string,
    sessionId: string
  ): Promise<void> {
    const ext = fileName.split('.').pop() || 'pdf';
    const today = new Date().toISOString().split('T')[0];
    const fileBuffer = Buffer.from(fileContentBase64, 'base64');

    // Step 1: Create attachment entry (no file content — SAP doesn't accept AttachmentContent)
    const metaPayload = {
      AttachmentEntry: null,
      FileName: fileName,
      SourceObjectType: '18',   // 18 = Purchase Invoice
      SourceObjectKey: String(docEntry),
      UserSignature: config.sapB1.username,
      Attachments2_Lines: [
        {
          FileName: fileName,
          FileExtension: ext,
          AttachmentDate: today,
          Override: 'tNO',
          FreeText: 'FlowDoc invoice document',
          SourcePath: '',
        },
      ],
    };

    console.log(`[SAP] Step 1: Creating attachment entry for DocEntry ${docEntry}: ${fileName}`);
    const metaResult = await this.post('/Attachments2', metaPayload, sessionId);
    console.log(`[SAP] Attachment entry response:`, JSON.stringify(metaResult, null, 2));

    const attachmentEntry = metaResult.AbsoluteEntry
      || metaResult.Attachments2_Lines?.[0]?.AttachmentEntry
      || metaResult.AttachmentEntry;

    if (!attachmentEntry) {
      console.error(`[SAP] No AttachmentEntry in response — attachment skipped`);
      return;
    }

    // Step 2: Upload raw file bytes
    console.log(`[SAP] Step 2: Uploading ${fileBuffer.length} bytes to AttachmentEntry ${attachmentEntry}`);
    const client = this.createClient();
    try {
      await client.post(
        `/Attachments2(${attachmentEntry})/$value`,
        fileBuffer,
        {
          headers: {
            Cookie: `B1SESSION=${sessionId}; ROUTEID=.node0`,
            'Content-Type': mimeType || 'application/octet-stream',
            'Content-Length': String(fileBuffer.length),
          },
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
        }
      );
      console.log(`[SAP] File uploaded successfully — ${fileBuffer.length} bytes`);
    } catch (uploadErr: any) {
      const msg = uploadErr.response?.data?.error?.message?.value || uploadErr.message;
      console.error(`[SAP] File upload failed: ${msg}`);
      if (uploadErr.response?.data) {
        console.error(`[SAP] Full error:`, JSON.stringify(uploadErr.response.data, null, 2));
      }
    }
  }
}

/** Shared singleton instance */
export const sapB1Client = new SapB1Client();
