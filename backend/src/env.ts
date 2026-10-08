import { config } from 'dotenv';
import { resolve } from 'path';

// Load .env from backend root regardless of cwd. Imported first in main.ts so that
// module decorators (e.g. JwtModule.register) see the values when they are evaluated.
config({ path: resolve(__dirname, '../.env') });
