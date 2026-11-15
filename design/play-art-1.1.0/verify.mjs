import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../../',import.meta.url));
const record=JSON.parse(await readFile(new URL('./generation.json',import.meta.url),'utf8'));
assert.equal(record.version,'1.1.0');
const roles=new Map();
for(const art of record.assets){
 const original=await readFile(resolve(root,art.original));
 const image=await readFile(resolve(root,art.source));
 const sha=b=>createHash('sha256').update(b).digest('hex');
 assert.equal(sha(original),art.originalSha256);
 assert.equal(sha(image),art.sourceSha256);
 assert.equal(image.subarray(1,4).toString(),'PNG');
 assert.equal(image.readUInt32BE(16),art.width);
 assert.equal(image.readUInt32BE(20),art.height);
 if(art.role==='icon')assert.equal(art.width,art.height);
 (roles.get(art.game)??(roles.set(art.game,[]),roles.get(art.game))).push(art.role);
}
for(const entries of roles.values())assert.deepEqual(entries.sort(),['background','cover','icon']);
console.log('Verified '+record.assets.length+' original and runtime presentation images.');
