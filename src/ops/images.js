// ops/images.js — images → PDF. Embed PNG/JPEG images as pages (each image becomes a
// page sized to the image). With a blank document this builds a PDF from images; with
// an open document it inserts them. pdf-lib embeds losslessly; deterministic.

import { getEngine } from '../core/engines.js';

function lib() { return getEngine('pdf-lib'); }
const isPng = (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
const isJpg = (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

export const ops = [
  {
    id: 'pages.insertImages', label: 'Insert images as pages', group: 'page', icon: 'image',
    description: 'Embed PNG/JPEG images as new pages (each page sized to its image). at = -1 appends.',
    agentCallable: true,
    params: {
      images: { type: 'array', required: true, minItems: 1, items: { type: 'bytes' } },
      at: { type: 'int', default: -1 },
    },
    async run(doc, { images, at }) {
      const count = doc.pageCount();
      let insertAt = at < 0 || at > count ? count : at;
      for (const raw of images) {
        const u8 = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
        let img;
        if (isPng(u8)) img = await doc.pdf.embedPng(u8);
        else if (isJpg(u8)) img = await doc.pdf.embedJpg(u8);
        else throw new Error('Only PNG and JPEG images are supported');
        const page = doc.pdf.insertPage(insertAt, [img.width, img.height]);
        page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
        insertAt++;
      }
      return { doc };
    },
  },
];
