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
  LicTradNum: string;
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
   * Finds a vendor (BusinessPartner) by RNC using LicTradNum.
   * FlowDoc vendor RNC ↔ SAP OCRD.LicTradNum
   * Returns the CardCode if found, null otherwise.
   */
  async findVendorByRnc(rnc: string, sessionId: string): Promise<BusinessPartner | null> {
    const encodedRnc = encodeURIComponent(rnc);
    const data = await this.get(
      `/BusinessPartners?$filter=LicTradNum eq '${encodedRnc}' and CardType eq 'cSupplier'&$top=1`,
      sessionId
    );

    if (data.value && data.value.length > 0) {
      const bp = data.value[0] as BusinessPartner;
      return bp;
    }
    return null;
  }

  /**
   * Creates a new vendor (BusinessPartner) in SAP B1.
   * CardCode is auto-generated as "V{rnc}".
   */
  async createVendor(
    vendor: { rnc: string; nombre: string; email?: string; telefono?: string },
    sessionId: string
  ): Promise<{ CardCode: string; CardName: string }> {
    const cardCode = `V${vendor.rnc}`;

    const payload = {
      CardCode: cardCode,
      CardName: vendor.nombre.substring(0, 100),
      CardType: 'cSupplier',
      LicTradNum: vendor.rnc,
      FederalTaxID: vendor.rnc,
      Currency: '##', // all currencies
      EmailAddress: vendor.email || '',
      Phone1: vendor.telefono || '',
    };

    const data = await this.post('/BusinessPartners', payload, sessionId);

    return {
      CardCode: data.CardCode || cardCode,
      CardName: data.CardName || vendor.nombre,
    };
  }
}

/** Shared singleton instance */
export const sapB1Client = new SapB1Client();
