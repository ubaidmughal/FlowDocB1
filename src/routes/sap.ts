import { Router, Request, Response } from 'express';
import { sapB1Client } from '../services/sapb1';
import { config } from '../config';

const router = Router();

/**
 * POST /api/sap/check-vendor
 * Checks if a vendor exists in SAP B1 by RNC (LicTradNum).
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
 * Body: { rnc, nombre, email?, telefono? }
 */
router.post('/api/sap/create-vendor', async (req: Request, res: Response) => {
  const { rnc, nombre, email, telefono } = req.body;
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
    const result = await sapB1Client.createVendor({ rnc, nombre, email, telefono }, sessionId);

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

export default router;
