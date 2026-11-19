import {execFileSync} from 'node:child_process';
const [major,minor,patch]=process.versions.node.split('.').map(Number);
if(major!==22||minor<22||(minor===22&&patch<0))throw Error('Liberty requires Node >=22.22.0 <23');
const npm=execFileSync('npm',['--version'],{encoding:'utf8'}).trim();
if(npm!=='10.9.4')throw Error(`Liberty requires npm 10.9.4; received ${npm}. Use scripts/with-pinned-npm.sh.`);
console.log(`Verified runtime: Node ${process.versions.node}, npm ${npm}`);
