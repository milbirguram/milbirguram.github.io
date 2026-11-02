// Minimal PNG decoder for the tests: 8-bit grayscale (colour type 0) or 8-bit RGB/RGBA,
// non-interlaced, as written by Pillow. Returns { width, height, data } where data holds
// one byte per pixel (the first channel).
'use strict';
var fs = require('fs');
var zlib = require('zlib');

function decode(path) {
  var buf = fs.readFileSync(path);
  var sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (var s = 0; s < 8; s++) if (buf[s] !== sig[s]) throw new Error('not a PNG: ' + path);
  var pos = 8, width = 0, height = 0, depth = 0, ctype = 0, interlace = 0, idat = [];
  var chunks = [];
  while (pos < buf.length) {
    var len = buf.readUInt32BE(pos), type = buf.toString('ascii', pos + 4, pos + 8);
    var body = buf.slice(pos + 8, pos + 8 + len);
    chunks.push(type);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0); height = body.readUInt32BE(4);
      depth = body[8]; ctype = body[9]; interlace = body[12];
    } else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (depth !== 8 || interlace !== 0) throw new Error('unsupported PNG layout: ' + path);
  var bpp = { 0: 1, 2: 3, 6: 4 }[ctype];
  if (!bpp) throw new Error('unsupported colour type ' + ctype + ': ' + path);
  var raw = zlib.inflateSync(Buffer.concat(idat));
  var stride = width * bpp, out = Buffer.alloc(stride * height), prev = Buffer.alloc(stride);
  for (var y = 0; y < height; y++) {
    var f = raw[y * (stride + 1)], line = raw.slice(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    var cur = out.slice(y * stride, (y + 1) * stride);
    for (var x = 0; x < stride; x++) {
      var a = x >= bpp ? cur[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0, v;
      if (f === 0) v = line[x];
      else if (f === 1) v = line[x] + a;
      else if (f === 2) v = line[x] + b;
      else if (f === 3) v = line[x] + ((a + b) >> 1);
      else if (f === 4) {
        var p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v = line[x] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      } else throw new Error('bad filter ' + f);
      cur[x] = v & 255;
    }
    prev = cur;
  }
  var data = new Uint8Array(width * height);
  for (var i = 0; i < data.length; i++) data[i] = out[i * bpp];
  return { width: width, height: height, data: data, chunks: chunks, colourType: ctype };
}

module.exports = { decode: decode };
