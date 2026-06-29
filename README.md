# FlowDocB1

Flow Doc to SAP Business One Connector Middleware

## Setup

```bash
npm install
cp .env.example .env   # then edit .env with real credentials
npm run dev
```

## Usage

**Claim invoices from FlowDoc (test mode):**
```bash
curl -X POST http://localhost:3000/api/GetInvInQueue
```

This endpoint:
1. Calls `POST /api/erp/sync/claim` on FlowDoc (10 items)
2. Saves the response to `data/claim_{batchId}_{timestamp}.json`
3. Reports all items back as `SAP_VENDOR_NOT_FOUND` (test/dry-run)

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start with ts-node (development) |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run compiled JS from `dist/` |
