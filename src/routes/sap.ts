import { Router, Request, Response } from 'express';
import { sapB1Client } from '../services/sapb1';
import { flowDocClient } from '../services/flowdoc';
import { config } from '../config';

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

    const result = await sapB1Client.createPurchaseInvoice(invoice, sessionId);

    // Attach document if invoiceId is provided
    let documentAttached = false;
    if (invoice.invoiceId) {
      try {
        console.log(`[SAP] Downloading document for invoice ${invoice.invoiceId}...`);
        const doc = await flowDocClient.getDocument(invoice.invoiceId);
        const base64 = doc.data.toString('base64');
        await sapB1Client.attachDocument(
          result.DocEntry,
          doc.filename,
          base64,
          doc.contentType,
          sessionId
        );
        documentAttached = true;
      } catch (docErr: any) {
        const status = docErr.response?.status;
        const body = docErr.response?.data;
        console.error(`[SAP] Document download FAILED (HTTP ${status || 'N/A'}): ${docErr.message}`);
        if (body) {
          console.error(`[SAP] FlowDoc response:`, typeof body === 'string' ? body.substring(0, 500) : JSON.stringify(body).substring(0, 500));
        }
        // Non-fatal — invoice was created
      }
    }

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

export default router;
