import { storeContract } from './contract.js';
import { MemoryStore } from '../../src/store/memory.js';

storeContract('memory', async () => new MemoryStore());
