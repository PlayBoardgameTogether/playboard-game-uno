import { unzipSync, strFromU8 } from 'fflate';
import { z } from 'zod';
import { AppError } from '../errors.js';
import { packagePresentationSchema } from './package-art.js';

export const packageDescriptorSchema = z.object({
  format: z.literal('boardgame-package-v1'),
  rules: z.string().trim().min(1).max(16000),
  presentation: packagePresentationSchema.optional(),
}).strict();

/** Fixed files only; inspect central-directory size/flags before any decompression. Never extract to disk. */
export function readGamePackage(bytes: Buffer) {
  const invalid = () => new AppError('VALIDATION_ERROR', 'ZIP 格式无效：需包含 game.json、server.js、client.html，且解压后不超过 2 MiB', 400);
  if (bytes.length > 5 * 1024 * 1024 || bytes.length < 22) throw invalid();
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (bytes.readUInt32LE(i) === 0x06054b50 && i + 22 + bytes.readUInt16LE(i + 20) === bytes.length) { end = i; break; }
  }
  if (end < 0 || bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6)) throw invalid();
  const count = bytes.readUInt16LE(end + 10), size = bytes.readUInt32LE(end + 12), start = bytes.readUInt32LE(end + 16);
  if (count !== 3 || bytes.readUInt16LE(end + 8) !== count || start + size !== end) throw invalid();
  const names = new Set(['game.json', 'server.js', 'client.html']);
  let position = start, total = 0;
  for (let n = 0; n < count; n++) {
    if (position + 46 > end || bytes.readUInt32LE(position) !== 0x02014b50) throw invalid();
    const flags = bytes.readUInt16LE(position + 8), method = bytes.readUInt16LE(position + 10);
    const compressed = bytes.readUInt32LE(position + 20), expanded = bytes.readUInt32LE(position + 24);
    const length = bytes.readUInt16LE(position + 28), extra = bytes.readUInt16LE(position + 30), comment = bytes.readUInt16LE(position + 32);
    const offset = bytes.readUInt32LE(position + 42), mode = bytes.readUInt32LE(position + 38) >>> 16;
    if (position + 46 + length + extra + comment > end) throw invalid();
    const name = bytes.subarray(position + 46, position + 46 + length).toString('utf8');
    total += expanded;
    if (!names.delete(name) || flags & 1 || ![0, 8].includes(method) || total > 2 * 1024 * 1024 ||
      expanded === 0 || (mode & 0xf000) === 0xa000 || offset + 30 > start || bytes.readUInt32LE(offset) !== 0x04034b50) throw invalid();
    const localName = bytes.readUInt16LE(offset + 26), localExtra = bytes.readUInt16LE(offset + 28);
    if (bytes.readUInt16LE(offset + 6) !== flags || bytes.readUInt16LE(offset + 8) !== method ||
      localName !== length || bytes.subarray(offset + 30, offset + 30 + localName).toString('utf8') !== name ||
      offset + 30 + localName + localExtra + compressed > start) throw invalid();
    position += 46 + length + extra + comment;
  }
  if (position !== end || names.size) throw invalid();
  try {
    const files = unzipSync(bytes);
    if (Object.values(files).reduce((sum, file) => sum + file.length, 0) > 2 * 1024 * 1024) throw invalid();
    const descriptor = packageDescriptorSchema.parse(JSON.parse(strFromU8(files['game.json']!)));
    return { ...descriptor, server: strFromU8(files['server.js']!), client: strFromU8(files['client.html']!) };
  } catch { throw invalid(); }
}
