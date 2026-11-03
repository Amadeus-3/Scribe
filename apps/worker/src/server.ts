import './instrument';
import { createServer } from 'node:http';
import { serve } from 'inngest/node';
import { logger } from '@scribe/core';
import { inngest } from './inngest/client';
import { functions } from './functions';

const handler = serve({ client: inngest, functions });
const port = Number(process.env.WORKER_PORT ?? 4100);

createServer(handler).listen(port, () => {
  logger.info({ port }, 'Scribe worker listening (Inngest functions served)');
});
