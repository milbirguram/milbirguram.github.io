"""Stream en_with_types.tgz from stdin and keep only the first few English shards.

Kaggle serves it inside a zip wrapper, which is inflated on the fly.
Usage: curl -sL <kaggle url for en_with_types.tgz> | python -I fetch.py OUTDIR N_SHARDS
The archive is ~3.9 GB compressed; we stop reading after N shards so only a few
hundred MB are ever downloaded or written.
"""
import os, sys, tarfile, shutil, struct, zlib


class ZipMemberStream:
    """Kaggle wraps the .tgz in a one-member zip (deflate). Inflate it on the fly."""
    def __init__(self, raw):
        self.raw = raw
        head = raw.read(30)
        assert head[:4] == b'PK', 'not a zip local header'
        method, = struct.unpack('<H', head[8:10])
        nlen, xlen = struct.unpack('<HH', head[26:30])
        raw.read(nlen + xlen)
        assert method == 8, 'expected deflate'
        self.z = zlib.decompressobj(-15)
        self.buf = b''

    def read(self, n=-1):
        while (n < 0 or len(self.buf) < n) and not self.z.eof:
            chunk = self.raw.read(1 << 20)
            if not chunk:
                break
            self.buf += self.z.decompress(chunk)
        if n < 0:
            n = len(self.buf)
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

out, n = sys.argv[1], int(sys.argv[2])
got = 0
with tarfile.open(fileobj=ZipMemberStream(sys.stdin.buffer), mode='r|gz') as tf:
    for m in tf:
        print('member', m.name, m.size, flush=True)
        if not m.isfile() or 'output-' not in m.name:
            continue
        dest = os.path.join(out, os.path.basename(m.name))
        src = tf.extractfile(m)
        with open(dest, 'wb') as f:
            shutil.copyfileobj(src, f, 1 << 20)
        got += 1
        if got >= n:
            break
print('kept', got, 'shards')
