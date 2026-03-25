import { createApp } from '../backend/app.js';

/** Vercel invokes `api/index.js` as `/api` — export the Express app (no serverless-http wrapper). */
export default createApp();
