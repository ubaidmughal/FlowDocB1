import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { sapB1Client } from '../services/sapb1';
import { flowDocClient } from '../services/flowdoc';
import { config } from '../config';

const ATTACHMENTS_DIR = 'C:\\SAP\\attachments';
const DATA_DIR = path.resolve(__dirname, '../../data/gl');

const router = Router();

/**
 * POST /api/sap/check-vendor
 * Checks if a vendor exists in SAP B1 by RNC (AddID).
 * Body: { rnc: string }
 */
router.post('/api/sap/check-vendor', async (req: Request, res: Response) => {
  const { rnc } = req.body;
  if (!rnc) {
    return res.status(400).json({ error: 'rnc is required' });
  }

  let sessionId: string | null = null;
  try {
    sessionId = await sapB1Client.login();
    const vendor = await sapB1Client.findVendorByRnc(rnc, sessionId);

    return res.json({
      found: vendor !== null,
      vendor: vendor || null,
      companyDb: config.sapB1.companyDb,
    });
  } catch (error: any) {
    console.error('[SAP CheckVendor] Error:', error.message);
    const sapError = error.response?.data?.error?.message?.value || error.message;
    return res.status(502).json({ error: sapError, companyDb: config.sapB1.companyDb });
  } finally {
    if (sessionId) {
      try { await sapB1Client.logout(sessionId); } catch { /* ignore */ }
    }
  }
});

/**
 * POST /api/sap/create-vendor
 * Creates a vendor in SAP B1.
 * Body: { rnc, nombre, email?, telefono?, direccion? }
 */
router.post('/api/sap/create-vendor', async (req: Request, res: Response) => {
  const { rnc, nombre, email, telefono, direccion } = req.body;
  if (!rnc || !nombre) {
    return res.status(400).json({ error: 'rnc and nombre are required' });
  }

  let sessionId: string | null = null;
  try {
    sessionId = await sapB1Client.login();

    // Check if already exists
    const existing = await sapB1Client.findVendorByRnc(rnc, sessionId);
    if (existing) {
      return res.json({
        created: false,
        alreadyExists: true,
        cardCode: existing.CardCode,
        cardName: existing.CardName,
        companyDb: config.sapB1.companyDb,
      });
    }

    // Create new vendor
    const result = await sapB1Client.createVendor({ rnc, nombre, email, telefono, direccion }, sessionId);

    return res.json({
      created: true,
      cardCode: result.CardCode,
      cardName: result.CardName,
      companyDb: config.sapB1.companyDb,
    });
  } catch (error: any) {
    console.error('[SAP CreateVendor] Error:', error.message);
    const sapError = error.response?.data?.error?.message?.value || error.message;
    return res.status(502).json({ error: sapError, companyDb: config.sapB1.companyDb });
  } finally {
    if (sessionId) {
      try { await sapB1Client.logout(sessionId); } catch { /* ignore */ }
    }
  }
});

/**
 * POST /api/sap/check-invoice
 * Checks if an invoice NCF already exists in SAP Purchase Invoices.
 * Body: { ncf: string }
 */
router.post('/api/sap/check-invoice', async (req: Request, res: Response) => {
  const { ncf } = req.body;
  if (!ncf) {
    return res.status(400).json({ error: 'ncf is required' });
  }

  let sessionId: string | null = null;
  try {
    sessionId = await sapB1Client.login();
    const exists = await sapB1Client.checkDuplicateNcf(ncf, sessionId);
    return res.json({ exists, ncf, companyDb: config.sapB1.companyDb });
  } catch (error: any) {
    console.error('[SAP CheckInvoice] Error:', error.message);
    const sapError = error.response?.data?.error?.message?.value || error.message;
    return res.status(502).json({ error: sapError, companyDb: config.sapB1.companyDb });
  } finally {
    if (sessionId) {
      try { await sapB1Client.logout(sessionId); } catch { /* ignore */ }
    }
  }
});

/**
 * POST /api/sap/post-invoice
 * Creates a Purchase Invoice in SAP B1 from FlowDoc invoice data.
 */
router.post('/api/sap/post-invoice', async (req: Request, res: Response) => {
  const invoice = req.body;
  if (!invoice.cardCode || !invoice.ncf) {
    return res.status(400).json({ error: 'cardCode and ncf are required' });
  }

  let sessionId: string | null = null;
  try {
    sessionId = await sapB1Client.login();

    // Check duplicate first
    const exists = await sapB1Client.checkDuplicateNcf(invoice.ncf, sessionId);
    if (exists) {
      return res.json({
        created: false,
        duplicate: true,
        message: `NCF ${invoice.ncf} already exists in SAP`,
        companyDb: config.sapB1.companyDb,
      });
    }

    // Step 1: Download documents and create attachment entry BEFORE posting invoice
    let attachmentEntry: number | null = null;
    let documentAttached = false;
    if (invoice.invoiceId) {
      try {
        console.log(`[SAP] Downloading document for invoice ${invoice.invoiceId}...`);
        const doc = await flowDocClient.getDocument(invoice.invoiceId);

        // Save to C:\SAP\attachments\
        if (!fs.existsSync(ATTACHMENTS_DIR)) {
          fs.mkdirSync(ATTACHMENTS_DIR, { recursive: true });
        }
        const cleanFileName = doc.filename.replace(/^.*[\\/]/, '');
        const filePath = path.join(ATTACHMENTS_DIR, cleanFileName);
        fs.writeFileSync(filePath, doc.data);
        console.log(`[SAP] File saved: ${filePath} (${doc.data.length} bytes)`);

        // Create attachment entry pointing to the saved file
        attachmentEntry = await sapB1Client.createAttachment(cleanFileName, ATTACHMENTS_DIR, sessionId);
        if (attachmentEntry) {
          documentAttached = true;
          console.log(`[SAP] Attachment entry ${attachmentEntry} will be embedded in invoice`);
        }
      } catch (docErr: any) {
        console.error(`[SAP] Document download warning: ${docErr.message}`);
      }
    }

    // Step 2: Create purchase invoice with attachment entry
    invoice.attachmentEntry = attachmentEntry;
    const result = await sapB1Client.createPurchaseInvoice(invoice, sessionId);

    return res.json({
      created: true,
      docEntry: result.DocEntry,
      docNum: result.DocNum,
      documentAttached,
      message: `Invoice posted — DocEntry: ${result.DocEntry}${documentAttached ? ' (with attachment)' : ''}`,
      companyDb: config.sapB1.companyDb,
    });
  } catch (error: any) {
    console.error('[SAP PostInvoice] Error:', error.message);
    const sapError = error.response?.data?.error?.message?.value || error.message;
    return res.status(502).json({ error: sapError, companyDb: config.sapB1.companyDb });
  } finally {
    if (sessionId) {
      try { await sapB1Client.logout(sessionId); } catch { /* ignore */ }
    }
  }
});

/**
 * POST /api/sap/fetch-gl-accounts
 * Fetches Chart of Accounts from SAP and saves to a JSON file.
 */
router.post('/api/sap/fetch-gl-accounts', async (_req: Request, res: Response) => {
  let sessionId: string | null = null;
  try {
    sessionId = await sapB1Client.login();
    const accounts = await sapB1Client.getChartOfAccounts(sessionId);

    // Save to data/gl_accounts.json (replaces existing)
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const filePath = path.join(DATA_DIR, 'gl_accounts.json');
    fs.writeFileSync(filePath, JSON.stringify({ accounts, fetchedAt: new Date().toISOString(), companyDb: config.sapB1.companyDb }, null, 2));
    console.log(`[SAP] GL accounts saved: ${filePath} (${accounts.length} accounts)`);

    return res.json({
      count: accounts.length,
      file: 'gl_accounts.json',
      companyDb: config.sapB1.companyDb,
    });
  } catch (error: any) {
    console.error('[SAP FetchGL] Error:', error.message);
    return res.status(502).json({ error: error.message, companyDb: config.sapB1.companyDb });
  } finally {
    if (sessionId) {
      try { await sapB1Client.logout(sessionId); } catch { /* ignore */ }
    }
  }
});

/**
 * GET /api/ui/gl-accounts
 * Returns the saved Chart of Accounts data with selections.
 */
router.get('/api/ui/gl-accounts', (_req: Request, res: Response) => {
  const filePath = path.join(DATA_DIR, 'gl_accounts.json');
  const selPath = path.join(DATA_DIR, 'gl_selections.json');
  if (!fs.existsSync(filePath)) {
    return res.json({ accounts: [], fetchedAt: null, count: 0, selectedCodes: [] });
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw);
    let selectedCodes: string[] = [];
    if (fs.existsSync(selPath)) {
      selectedCodes = JSON.parse(fs.readFileSync(selPath, 'utf-8'));
    }
    return res.json({ ...data, selectedCodes, count: data.accounts?.length || 0 });
  } catch {
    return res.json({ accounts: [], fetchedAt: null, count: 0, selectedCodes: [] });
  }
});

/**
 * POST /api/ui/gl-selections
 * Saves selected GL account codes.
 */
router.post('/api/ui/gl-selections', (req: Request, res: Response) => {
  try {
    const { selectedCodes } = req.body;
    if (!Array.isArray(selectedCodes)) {
      return res.status(400).json({ error: 'selectedCodes must be an array' });
    }
    const selPath = path.join(DATA_DIR, 'gl_selections.json');
    fs.writeFileSync(selPath, JSON.stringify(selectedCodes, null, 2));
    return res.json({ saved: true, count: selectedCodes.length });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/sap/push-gl-selections
 * Pushes selected GL accounts to FlowDoc master data.
 */
router.post('/api/sap/push-gl-selections', async (_req: Request, res: Response) => {
  try {
    const selPath = path.join(DATA_DIR, 'gl_selections.json');
    const accountsPath = path.join(DATA_DIR, 'gl_accounts.json');

    if (!fs.existsSync(selPath) || !fs.existsSync(accountsPath)) {
      return res.status(400).json({ error: 'No GL data or selections found. Fetch G/L first.' });
    }

    const selectedCodes: string[] = JSON.parse(fs.readFileSync(selPath, 'utf-8'));
    if (!selectedCodes.length) {
      return res.status(400).json({ error: 'No accounts selected.' });
    }

    const { accounts } = JSON.parse(fs.readFileSync(accountsPath, 'utf-8'));
    const items = selectedCodes
      .map(code => {
        const acc = accounts.find((a: any) => a.Code === code);
        return acc ? { code: acc.Code, name: acc.Name } : null;
      })
      .filter(Boolean) as Array<{ code: string; name: string }>;

    const result = await flowDocClient.pushMasterData('gl_accounts', items);
    return res.json({ pushed: items.length, flowDocResponse: result });
  } catch (error: any) {
    console.error('[PushGL] Error:', error.message);
    return res.status(502).json({ error: error.message });
  }
});

// ═══════════ Profit Centers ═══════════

const PC_DIR = path.resolve(__dirname, '../../data/pc');

/**
 * POST /api/sap/fetch-profit-centers
 */
router.post('/api/sap/fetch-profit-centers', async (_req: Request, res: Response) => {
  let sessionId: string | null = null;
  try {
    sessionId = await sapB1Client.login();
    const centers = await sapB1Client.getProfitCenters(sessionId);
    if (!fs.existsSync(PC_DIR)) fs.mkdirSync(PC_DIR, { recursive: true });
    fs.writeFileSync(path.join(PC_DIR, 'profit_centers.json'), JSON.stringify({ centers, fetchedAt: new Date().toISOString(), companyDb: config.sapB1.companyDb }, null, 2));
    return res.json({ count: centers.length, companyDb: config.sapB1.companyDb });
  } catch (error: any) {
    console.error('[SAP FetchPC] Error:', error.message);
    return res.status(502).json({ error: error.message });
  } finally {
    if (sessionId) { try { await sapB1Client.logout(sessionId); } catch {} }
  }
});

/**
 * GET /api/ui/profit-centers
 */
router.get('/api/ui/profit-centers', (_req: Request, res: Response) => {
  const fp = path.join(PC_DIR, 'profit_centers.json');
  const sp = path.join(PC_DIR, 'pc_selections.json');
  if (!fs.existsSync(fp)) return res.json({ centers: [], selectedCodes: [], count: 0 });
  try {
    const data = JSON.parse(fs.readFileSync(fp, 'utf-8'));
    const sel = fs.existsSync(sp) ? JSON.parse(fs.readFileSync(sp, 'utf-8')) : [];
    return res.json({ ...data, selectedCodes: sel, count: data.centers?.length || 0 });
  } catch { return res.json({ centers: [], selectedCodes: [], count: 0 }); }
});

/**
 * POST /api/ui/pc-selections
 */
router.post('/api/ui/pc-selections', (req: Request, res: Response) => {
  try {
    const { selectedCodes } = req.body;
    if (!Array.isArray(selectedCodes)) return res.status(400).json({ error: 'invalid' });
    if (!fs.existsSync(PC_DIR)) fs.mkdirSync(PC_DIR, { recursive: true });
    fs.writeFileSync(path.join(PC_DIR, 'pc_selections.json'), JSON.stringify(selectedCodes, null, 2));
    return res.json({ saved: true, count: selectedCodes.length });
  } catch (error: any) { return res.status(500).json({ error: error.message }); }
});

/**
 * POST /api/sap/push-pc-selections
 */
router.post('/api/sap/push-pc-selections', async (_req: Request, res: Response) => {
  try {
    const sp = path.join(PC_DIR, 'pc_selections.json');
    const fp = path.join(PC_DIR, 'profit_centers.json');
    if (!fs.existsSync(sp) || !fs.existsSync(fp)) return res.status(400).json({ error: 'No data. Fetch profit centers first.' });
    const codes: string[] = JSON.parse(fs.readFileSync(sp, 'utf-8'));
    if (!codes.length) return res.status(400).json({ error: 'No centers selected.' });
    const { centers } = JSON.parse(fs.readFileSync(fp, 'utf-8'));
    const items = codes.map(c => { const cc = centers.find((x: any) => x.CenterCode === c); return cc ? { code: cc.CenterCode, name: cc.CenterName } : null; }).filter(Boolean) as Array<{ code: string; name: string }>;
    const result = await flowDocClient.pushMasterData('cost_centers', items);
    return res.json({ pushed: items.length, flowDocResponse: result });
  } catch (error: any) { return res.status(502).json({ error: error.message }); }
});

export default router;
