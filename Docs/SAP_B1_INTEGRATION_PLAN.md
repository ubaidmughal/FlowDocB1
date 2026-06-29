# SAP Business One Integration Plan — FlowDoc.ai

## Overview

FlowDoc is an invoice processing platform for Dominican Republic businesses. It receives invoices (email, manual upload), extracts data via OCR (Claude AI), validates against DGII (Dominican tax authority), auto-approves based on configurable rules, and queues approved invoices for ERP synchronization.

**Your job**: Build a middleware service that reads the FlowDoc sync queue via API and creates Purchase Invoices in SAP Business One via Service Layer.

---

## Architecture

```
FlowDoc (SaaS)  ←→  Your Middleware  ←→  Client's SAP B1
   API key            reads queue,         Service Layer
                      syncs invoices       REST API
```

- FlowDoc stores ERP credentials per client in its settings
- Your middleware reads those credentials via `GET /api/settings`
- Each client is just a configuration — no code changes needed per client

---

## SAP B1 Service Layer (REST API)

- **Base URL**: `https://{server}:50000/b1s/v1` (HTTPS, port 50000)
- **Auth**: Session-based (Login → SessionId cookie → Logout)
- **CompanyDB**: Client's company database in SAP

### Endpoints

| Operation | Method | Endpoint |
|---|---|---|
| Login | POST | `/Login` |
| Logout | POST | `/Logout` |
| Create purchase invoice | POST | `/PurchaseInvoices` |
| Find vendor by tax ID | GET | `/BusinessPartners?$filter=FederalTaxID eq '{rnc}'` |
| Create vendor | POST | `/BusinessPartners` |
| Check duplicate NCF | GET | `/PurchaseInvoices?$filter=U_NCF eq '{ncf}'` |
| Exchange rate | GET | `/ExchangeRates?$filter=...` |

---

## Field Mapping: FlowDoc → SAP B1

### Purchase Invoice (PurchaseInvoices)

```json
{
  "CardCode": "vendors.erp_card_code",
  "DocDate": "invoices.fecha_emision (invoice date)",
  "TaxDate": "invoices.fecha_emision",
  "DocDueDate": "invoices.fecha_emision",
  "DocCurrency": "invoices.moneda (DOP or USD)",
  "DocRate": "Prefer SAP's daily rate via GET /ExchangeRates. Fallback: invoices.tasa_cambio",
  "Comments": "NCF: {ncf} | Processed by FlowDoc",
  "U_NCF": "invoices.ncf (tax invoice number) — for international invoices: invoice number",
  "U_TipoNCF": "invoices.ncf_type (E31/B01/B02/E34/international/etc.)",
  "Series": "company_settings.erp_doc_series",
  "DiscountPercent": "Calculate from invoices.descuento / invoices.subtotal * 100 (if discount applies)",
  "DocumentLines": [
    {
      "ItemDescription": "invoice_items.descripcion",
      "Quantity": "invoice_items.cantidad",
      "UnitPrice": "invoice_items.precio",
      "AccountCode": "invoices.gl_account || company_settings.erp_account_code",
      "CostingCode": "invoices.cost_center || company_settings.erp_cost_center",
      "TaxCode": "18% → erp_tax_code_itbis | 0% → erp_tax_code_exempt",
      "WarehouseCode": "company_settings.erp_warehouse_code (optional)"
    }
  ]
}
```

### Vendor (BusinessPartners)

```json
{
  "CardCode": "V{rnc}",
  "CardName": "vendors.nombre (vendor name)",
  "CardType": "cSupplier",
  "FederalTaxID": "vendors.rnc (tax ID — 9 or 11 digits)",
  "Address": "vendors.direccion",
  "Currency": "##"  // "##" = all currencies (SAP convention for multi-currency vendors)
}
```

---

## Sync Flow

```
1. Claim invoices from FlowDoc
   POST /api/erp/sync/claim { limit: 10 }
   → Returns batchId + items with full invoice/vendor data
   → Items are atomically marked as 'syncing' (no duplicates)

2. Login to SAP Service Layer
   POST /Login { CompanyDB, UserName, Password }
   → Store SessionId cookie

3. For each claimed invoice:
   a. Download document from FlowDoc
      GET /api/documents/{invoice_id}?download=1
      → Returns PDF, JPEG, PNG, or WebP (check Content-Type header)

   b. Check if vendor exists in SAP
      GET /BusinessPartners?$filter=FederalTaxID eq '{rnc}'
      → If not found: POST /BusinessPartners (create)
      → Store CardCode

   c. Check for duplicate by NCF + vendor
      GET /PurchaseInvoices?$filter=U_NCF eq '{ncf}' and CardCode eq '{cardCode}'
      → If exists: report as 'dup', skip

   d. Create purchase invoice
      POST /PurchaseInvoices { ...payload }
      → Store DocEntry as erp_doc_id
      → Attach document: POST /Attachments2 (optional)

4. Report all results to FlowDoc
   POST /api/erp/webhook { batchId, results: [...] }

5. Logout from SAP Service Layer
   POST /Logout
```

---

## Sequence Diagram

```
FlowDoc                          SAP B1
  │                                │
  │  POST /Login                   │
  │ ─────────────────────────────► │
  │  ◄─── SessionId ──────────────│
  │                                │
  │  GET /BusinessPartners?rnc=... │
  │ ─────────────────────────────► │
  │  ◄─── CardCode ───────────────│
  │                                │
  │  GET /PurchaseInvoices?ncf=... │
  │ ─────────────────────────────► │
  │  ◄─── [] (no duplicate) ──────│
  │                                │
  │  POST /PurchaseInvoices        │
  │  { CardCode, Lines[], NCF }    │
  │ ─────────────────────────────► │
  │  ◄─── { DocEntry: 12345 } ────│
  │                                │
  │  POST /Logout                  │
  │ ─────────────────────────────► │
  │                                │
  └── invoice.erp_doc_id = 12345   │
      invoice.status = 'synced'
```

---

## Implementation Phases

### Phase 1: SAP Client Library
- `sapLogin(settings): Promise<string>` — returns sessionId
- `sapLogout(sessionId)`
- `sapRequest(method, endpoint, body?, sessionId)` — wrapper with retry
- `findVendorByRnc(rnc, sessionId): Promise<CardCode | null>`
- `createVendor(vendor, sessionId): Promise<CardCode>`
- `checkDuplicateNcf(ncf, cardCode, sessionId): Promise<boolean>`
- `createPurchaseInvoice(payload, sessionId): Promise<DocEntry>`
- `testConnection(settings): Promise<boolean>`

### Phase 2: Queue Processor
- Poll `POST /api/erp/sync/claim` on a cron schedule (e.g., every 5 minutes)
- Claim returns full invoice + vendor data — no need for separate GET calls
- Download document via `GET /api/documents/:id?download=1` (PDF, JPEG, PNG, or WebP)
- Execute sync flow (Phase 1 functions)
- Report results via `POST /api/erp/webhook`

### Phase 3: Master Data Sync + Additional Features
- Sync Chart of Accounts → `POST /api/erp/master-data { type: "gl_accounts", items: [...] }`
- Sync Cost Centers → `POST /api/erp/master-data { type: "cost_centers", items: [...] }`
- Sync Tax Codes → `POST /api/erp/master-data { type: "tax_codes", items: [...] }`
- Sync Projects → `POST /api/erp/master-data { type: "projects", items: [...] }`
- Test connection endpoint
- Vendor sync from SAP → FlowDoc

### Phase 4: Automation & Reliability
- Cron job for automatic sync based on configured schedules
- Automatic retry with exponential backoff (max 3 attempts)
- Error notifications via email

---

## Security Considerations

1. **Password handling**: ERP passwords are NOT exposed via the FlowDoc API. Your middleware must receive SAP credentials through its own secure configuration (environment variables, secrets manager, etc.).
2. **Session management**: Login → process batch → logout. Do not keep sessions open.
3. **Rate limiting**: Max 1 concurrent sync per company.
4. **Logging**: Never log passwords. Only log errors and document IDs.
5. **Timeout**: 30s per Service Layer request, 5min per full batch.

---

## SAP-Side Requirements

1. **Service Layer active** on the SAP server (port 50000 HTTPS)
2. **SAP user** with permissions for:
   - Create Purchase Invoices
   - Read/Create Business Partners
   - Access to the client's CompanyDB
3. **User-Defined Fields (UDFs)**:
   - `U_NCF` on Purchase Invoices (string, max 20)
   - `U_TipoNCF` on Purchase Invoices (string, max 10)
4. **SSL certificate** — valid or self-signed (configure `NODE_TLS_REJECT_UNAUTHORIZED` if needed)

---

## Time Estimate

| Phase | Effort |
|---|---|
| Phase 1: SAP Client lib | 1 day |
| Phase 2: Queue Processor | 1 day |
| Phase 3: Additional features | 0.5 days |
| Phase 4: Automation | 0.5 days |
| Testing with real SAP | 1-2 days |
| **Total** | **4-5 days** |

---

## Deliverable

A standalone Node.js service (or language of your choice) that:
- Connects to FlowDoc API using an API key
- Reads the ERP sync queue
- Creates Purchase Invoices in SAP B1 via Service Layer
- Reports results back to FlowDoc via webhook
- Is deployable as a Docker container or standalone service
- Includes a README with setup instructions
