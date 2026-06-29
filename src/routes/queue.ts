import { Router, Request, Response } from 'express';
import { flowDocClient, ClaimItem, WebhookResultItem } from '../services/flowdoc';
import { saveClaimResponse } from '../services/storage';

const router = Router();

/**
 * POST /api/GetInvInQueue
 *
 * Claims up to 10 invoices from FlowDoc, saves the response to disk,
 * and reports every item back as SAP_VENDOR_NOT_FOUND (test mode).
 */
router.post('/api/GetInvInQueue', async (_req: Request, res: Response) => {
  console.log('[GetInvInQueue] Starting claim from FlowDoc...');

  try {
    // 1. Claim invoices from FlowDoc
    const claimResponse = await flowDocClient.claim(10);
    const { batchId, total, items } = claimResponse;

    console.log(`[GetInvInQueue] Claimed ${total} invoice(s) — batchId: ${batchId}`);

    if (total === 0) {
      return res.json({
        batchId,
        totalClaimed: 0,
        reportedCount: 0,
        message: 'No invoices in queue.',
      });
    }

    // 2. Save claim response to JSON file
    const savedPath = saveClaimResponse(batchId, claimResponse);
    console.log(`[GetInvInQueue] Saved claim data → ${savedPath}`);

    // 3. Build webhook results — all as SAP_VENDOR_NOT_FOUND (test mode)
    const results: WebhookResultItem[] = items.map((item: ClaimItem) => ({
      invoiceId: item.invoice_id,
      success: false,
      errorCode: 'SAP_VENDOR_NOT_FOUND',
      errorMessage: 'Keeping invoice back to queue for testing again',
    }));

    // 4. Report results back to FlowDoc
    console.log(`[GetInvInQueue] Reporting ${results.length} result(s) to webhook...`);
    const webhookResponse = await flowDocClient.reportWebhook({
      batchId,
      results,
    });

    console.log(
      `[GetInvInQueue] Webhook done — processed: ${webhookResponse.processed}, ` +
      `errors: ${webhookResponse.errors}, total: ${webhookResponse.total}`
    );

    return res.json({
      batchId,
      totalClaimed: total,
      reportedCount: results.length,
      webhookResponse,
    });
  } catch (error: any) {
    console.error('[GetInvInQueue] Error:', error.message);
    if (error.response) {
      console.error('[GetInvInQueue] FlowDoc responded:', error.response.status, error.response.data);
    }
    return res.status(502).json({
      error: 'Failed to communicate with FlowDoc.',
      detail: error.message,
    });
  }
});

export default router;
