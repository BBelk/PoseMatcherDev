export async function readExifDate(file) {
  try {
    const buf = await file.slice(0, 65536).arrayBuffer();
    const view = new DataView(buf);

    if (view.getUint16(0) !== 0xFFD8) return null;

    let offset = 2;
    while (offset < view.byteLength - 4) {
      const marker = view.getUint16(offset);
      if (marker === 0xFFE1) break;
      if ((marker & 0xFF00) !== 0xFF00) return null;
      offset += 2 + view.getUint16(offset + 2);
    }

    const app1Start = offset + 4;
    if (view.getUint32(app1Start) !== 0x45786966 || view.getUint16(app1Start + 4) !== 0) return null;

    const tiffStart = app1Start + 6;
    const le = view.getUint16(tiffStart) === 0x4949;

    function u16(o) { return view.getUint16(tiffStart + o, le); }
    function u32(o) { return view.getUint32(tiffStart + o, le); }

    let ifdStart = u32(4);
    let entries = u16(ifdStart);
    let exifOffset = null;
    for (let i = 0; i < entries; i++) {
      const entryOff = ifdStart + 2 + i * 12;
      if (u16(entryOff) === 0x8769) {
        exifOffset = u32(entryOff + 8);
        break;
      }
    }
    if (!exifOffset) return null;

    entries = u16(exifOffset);
    for (let i = 0; i < entries; i++) {
      const entryOff = exifOffset + 2 + i * 12;
      const tag = u16(entryOff);
      if (tag === 0x9003 || tag === 0x9004 || tag === 0x0132) {
        const strOffset = u32(entryOff + 8);
        let str = '';
        for (let j = 0; j < 19; j++) {
          str += String.fromCharCode(view.getUint8(tiffStart + strOffset + j));
        }
        return str.slice(0,4) + '-' + str.slice(5,7) + '-' + str.slice(8,10) + ' ' + str.slice(11);
      }
    }
    return null;
  } catch (e) {
    return null;
  }
}
