import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const script=process.argv[2];
if(!/^scripts\/[a-zA-Z0-9_./-]+\.ts$/.test(script)||script.includes('..'))throw new Error('INVALID_SUITE_PATH');
try{await import(pathToFileURL(resolve(script)).href);process.exit(0);}catch(error){console.error(error);process.exit(1);}
