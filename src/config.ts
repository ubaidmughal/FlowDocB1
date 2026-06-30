import dotenv from 'dotenv';
dotenv.config();

export const config = {
  flowdoc: {
    baseUrl: process.env.FLOWDOC_BASE_URL || 'https://app.flow-doc.ai',
    apiKey: process.env.FLOWDOC_API_KEY || '',
  },
  sapB1: {
    baseUrl: process.env.B1SL_BASE_URL || '',
    companyDb: process.env.B1SL_COMPANY_DB || '',
    username: process.env.B1SL_USERNAME || '',
    password: process.env.B1SL_PASSWORD || '',
    tlsRejectUnauthorized: process.env.B1SL_TLS_REJECT_UNAUTHORIZED !== 'false',
  },
  server: {
    port: parseInt(process.env.PORT || '3000', 10),
  },
};
