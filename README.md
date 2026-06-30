# FlowDocB1

Flow Doc to SAP Business One Connector Middleware

## Setup

```bash
npm install
cp .env.example .env   # then edit .env with real credentials
npm run build
npm run dev
```

## Dashboard

Open `http://localhost:3000` for the web dashboard with:
- **Dashboard** — summary stats (files, invoices, amounts, vendors)
- **Saved Data** — browse claim JSON files with tabbed detail view
- **API Tester** — one-click test of the claim + webhook round-trip

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/GetInvInQueue` | Claim 10 invoices, save to disk, report back (test mode) |
| GET | `/api/ui/dashboard` | Summary stats for the dashboard |
| GET | `/api/ui/saved-files` | List all saved claim files |
| GET | `/api/ui/saved-files/:filename` | Get content of a saved file |

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start with ts-node (development) |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run compiled JS from `dist/` |
