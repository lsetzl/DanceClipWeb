"""MP4 の各トラックの edit list(elst)と最初のサンプル時刻を表示する。usage: python tools/mp4boxes.py file.mp4"""
import struct
import sys

CONTAINERS = {b"moov", b"trak", b"mdia", b"minf", b"stbl", b"edts"}


def walk(data, off, end, path, out):
    while off + 8 <= end:
        size, typ = struct.unpack(">I4s", data[off:off + 8])
        hdr = 8
        if size == 1:
            size = struct.unpack(">Q", data[off + 8:off + 16])[0]
            hdr = 16
        elif size == 0:
            size = end - off
        body = data[off + hdr:off + size]
        p = path + [typ.decode("latin1")]
        if typ in CONTAINERS:
            walk(data, off + hdr, off + size, p, out)
        else:
            out.append((p, body))
        off += size


def main(fn):
    data = open(fn, "rb").read()
    boxes = []
    walk(data, 0, len(data), [], boxes)
    trak = -1
    for p, body in boxes:
        if p[-1] == "tkhd":
            trak += 1
        if p[-1] == "mdhd":
            v = body[0]
            ts = struct.unpack(">I", body[12:16] if v == 0 else body[20:24])[0]
            print(f"track{trak} mdhd timescale={ts}")
        if p[-1] == "hdlr":
            print(f"track{trak} handler={body[8:12].decode()}")
        if p[-1] == "elst":
            v = body[0]
            n = struct.unpack(">I", body[4:8])[0]
            ents = []
            o = 8
            for _ in range(n):
                if v == 1:
                    d, t = struct.unpack(">Qq", body[o:o + 16]); o += 16
                else:
                    d, t = struct.unpack(">Ii", body[o:o + 8]); o += 8
                r = struct.unpack(">hh", body[o:o + 4]); o += 4
                ents.append((d, t, r))
            print(f"track{trak} elst (segment_duration[movie ts], media_time[media ts], rate) = {ents}")
        if p[-1] == "ctts":
            n = struct.unpack(">I", body[4:8])[0]
            first = struct.unpack(">Ii", body[8:16]) if n else None
            print(f"track{trak} ctts first={first}")
        if p[-1] == "mvhd":
            v = body[0]
            ts = struct.unpack(">I", body[12:16] if v == 0 else body[20:24])[0]
            print(f"movie timescale={ts}")


main(sys.argv[1])
