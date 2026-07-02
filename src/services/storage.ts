import fs from 'fs';
import path from 'path';
import { ClaimResponse } from './flowdoc';

const DATA_DIR = path.resolve(__dirname, '../../data/claims');

/**
 * Saves the raw claim response to a timestamped JSON file.
 * Returns the file path so the caller can log it.
 */
export function saveClaimResponse(batchId: string, data: ClaimResponse): string {
  // Ensure data directory exists
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `claim_${batchId}_${timestamp}.json`;
  const filePath = path.join(DATA_DIR, filename);

  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  return filePath;
}
