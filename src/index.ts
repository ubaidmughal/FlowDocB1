import express from 'express';
import path from 'path';
import { config } from './config';
import queueRoutes from './routes/queue';
import uiRoutes from './routes/ui';

const app = express();

// Trust proxy headers from Nginx (SSL termination)
app.set('trust proxy', 1);

// Middleware
app.use(express.json());

// Static files (dashboard UI)
app.use(express.static(path.join(__dirname, '..', 'public')));

// Routes
app.use(queueRoutes);
app.use(uiRoutes);

// Start
app.listen(config.server.port, () => {
  console.log(`FlowDocB1 middleware running on http://localhost:${config.server.port}`);
  console.log(`Dashboard → http://localhost:${config.server.port}`);
  console.log(`FlowDoc   → ${config.flowdoc.baseUrl}`);
  console.log(`SAP B1    → ${config.sapB1.baseUrl}`);
});
