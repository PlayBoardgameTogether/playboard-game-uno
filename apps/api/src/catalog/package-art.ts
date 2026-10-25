import { z } from 'zod';
/** PNG-only public artwork: bounded bytes/pixels, exact base64 and PNG framing. Never interpret SVG/HTML. */
export const packageImageSchema = z.string().max(450000).superRefine((value, context) => {
    const fail = () => context.addIssue({ code: 'custom', message: '展示图必须是有效的 PNG data URL，最多 320 KiB、2048×2048 像素' });
    const prefix = 'data:image/png;base64,';
    if (!value.startsWith(prefix)) {
        fail();
        return;
    }
    const encoded = value.slice(prefix.length);
    const bytes = Buffer.from(encoded, 'base64');
    if (bytes.length < 57 || bytes.length > 320 * 1024 || bytes.toString('base64') !== encoded
        || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
        || bytes.readUInt32BE(8) !== 13 || bytes.subarray(12, 16).toString() !== 'IHDR'
        || bytes.readUInt32BE(16) < 1 || bytes.readUInt32BE(16) > 2048
        || bytes.readUInt32BE(20) < 1 || bytes.readUInt32BE(20) > 2048) {
        fail();
        return;
    }
    let offset = 8;
    let imageData = false;
    while (offset + 12 <= bytes.length) {
        const length = bytes.readUInt32BE(offset);
        const kind = bytes.subarray(offset + 4, offset + 8).toString();
        if (offset + 12 + length > bytes.length) {
            fail();
            return;
        }
        if (kind === 'IDAT')
            imageData = true;
        if (kind === 'IEND') {
            if (length !== 0 || offset + 12 !== bytes.length || !imageData)
                fail();
            return;
        }
        offset += length + 12;
    }
    fail();
});
export const packagePresentationSchema = z.object({
    icon: packageImageSchema.optional(),
    cover: packageImageSchema.optional(),
    background: packageImageSchema.optional(),
}).strict();
export const packageArtworkKindSchema = z.enum(['icon', 'cover', 'background']);
