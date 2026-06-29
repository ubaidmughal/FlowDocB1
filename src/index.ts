import express from 'express';
import { config } from './config';
import queueRoutes from './routes/queue';

const app = express();

// Middleware
app.use(express.json());

// Routes
app.use(queueRoutes);

// Start
app.listen(config.server.port, () => {
  console.log(`FlowDocB1 middleware running on http://localhost:${config.server.port}`);
  console.log(`FlowDoc  base: ${config.flowdoc.baseUrl}`);
  console.log(`SAP B1   base: ${config.sapB1.baseUrl}`);
  console.log(`→ POST http://localhost:${config.server.port}/api/GetInvInQueue to claim & test`);
});
