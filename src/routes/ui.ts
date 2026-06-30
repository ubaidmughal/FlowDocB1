import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { flowDocClient } from '../services/flowdoc';

const router = Router();
const DATA_DIR = path.resolve(__dirname, '../../data');

/**
 * GET /api/ui/dashboard
 * Returns summary stats for the dashboard.
 */
router.get('/api/ui/dashboard', (_req: Request, res: Response) => {
  try {
    const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json'));

    let totalInvoices = 0;
    let totalAmount = 0;
    let lastSync: string | null = null;
    const vendors = new Set<string>();
    const ncfTypes = new Map<string, number>();

    for (const file of files) {
      const raw = fs.readFileSync(path.join(DATA_DIR, file), 'utf-8');
      try {
        const data = JSON.parse(raw);
        totalInvoices += data.total || 0;

        if (data.items) {
          for (const item of data.items) {
            totalAmount += parseFloat(item.total) || 0;
            if (item.vendor_nombre) vendors.add(item.vendor_nombre);
            if (item.ncf_type) {
              ncfTypes.set(item.ncf_type, (ncfTypes.get(item.ncf_type) || 0) + 1);
            }
          }
        }

        const match = file.match(/(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)/);
        if (match && (!lastSync || match[1] > lastSync)) {
          lastSync = match[1].replace(/-/g, (c, i) => i === 13 || i === 16 ? ':' : c).replace('T', ' ').replace('Z', '');
        }
      } catch { /* skip corrupted files */ }
    }

    return res.json({
      totalClaimFiles: files.length,
      totalInvoices,
      totalAmount: Math.round(totalAmount * 100) / 100,
      uniqueVendors: vendors.size,
      lastSync,
      ncfTypeBreakdown: Object.fromEntries(ncfTypes),
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/ui/saved-files
 * Lists all saved claim JSON files with metadata.
 */
router.get('/api/ui/saved-files', (_req: Request, res: Response) => {
  try {
    const files = fs.readdirSync(DATA_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        const raw = fs.readFileSync(path.join(DATA_DIR, f), 'utf-8');
        let meta: any = {};
        try {
          const data = JSON.parse(raw);
          meta = { batchId: data.batchId, total: data.total, invoiceCount: data.items?.length || 0 };
        } catch { /* skip */ }
        const stat = fs.statSync(path.join(DATA_DIR, f));
        return {
          filename: f,
          size: stat.size,
          createdAt: stat.birthtime,
          ...meta,
        };
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return res.json(files);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/ui/saved-files/:filename
 * Returns the full content of a saved claim file.
 */
router.get('/api/ui/saved-files/:filename', (req: Request, res: Response) => {
  try {
    const filePath = path.join(DATA_DIR, req.params.filename);

    // Prevent directory traversal
    if (!filePath.startsWith(DATA_DIR)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    const raw = fs.readFileSync(filePath, 'utf-8');
    return res.json(JSON.parse(raw));
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/ui/invoice-detail/:invoiceId
 * Proxies FlowDoc's GET /api/invoices/:id to get full invoice detail.
 */
router.get('/api/ui/invoice-detail/:invoiceId', async (req: Request, res: Response) => {
  try {
    const data = await flowDocClient.getInvoiceDetail(req.params.invoiceId);
    return res.json(data);
  } catch (error: any) {
    console.error('[InvoiceDetail] Error:', error.message);
    if (error.response) {
      return res.status(error.response.status).json({
        error: 'FlowDoc API error',
        status: error.response.status,
        detail: error.response.data,
      });
    }
    return res.status(502).json({ error: error.message });
  }
});

export default router;
