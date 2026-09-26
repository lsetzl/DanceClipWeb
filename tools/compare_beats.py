"""ブラウザ版の onset / 拍を GUI版(librosa)と比べる。usage: python tools/compare_beats.py ref.json web.json"""
import json
import sys

import numpy as np

r = json.load(open(sys.argv[1])); w = json.load(open(sys.argv[2]))
o1, o2 = np.array(r['onset']), np.array(w['onset'])
n = min(len(o1), len(o2))
print('onset corr', round(np.corrcoef(o1[:n], o2[:n])[0, 1], 5), 'max|d|', round(float(np.abs(o1[:n] - o2[:n]).max()), 3))
b1, b2 = np.array(r['beats']), np.array(w['beats'])
d = np.array([np.min(np.abs(b1 - x)) for x in b2])
print('beats', len(b1), len(b2), 'within 20ms', int((d < 0.0201).sum()), 'worst ms', round(float(d.max()) * 1000, 1),
      'outliers', [round(float(x), 2) for x, e in zip(b2, d) if e > 0.0201])
