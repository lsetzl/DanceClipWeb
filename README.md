# DanceClip Web

Sync a silent dance video with a song, trim it, add fades, and export an MP4 — entirely in your browser.
Your video and song never leave your device.

無音のダンス動画と曲を同期し、トリムとフェードをかけて MP4 に書き出すツールです。処理はすべてブラウザ内で行い、動画と曲はどこにも送信しません。

**https://lsetzl.github.io/DanceClipWeb/**

- 推奨ブラウザ / Recommended: Chrome, Edge (PC / Android)
- 書き出し / Export: WebCodecs (H.264 14Mbps + AAC 192kbps) + [Mediabunny](https://mediabunny.dev/)
- 設定はブラウザ内(IndexedDB)に自動保存。JSON での保存 / 読み込みも可能

## 使い方 / How to use

1. 動画と曲を選ぶ(ドロップでも可)。動画の音声は使いません
2. タイムラインの「動画」の段を左右にドラッグして、動きの山(水色)を曲の拍(黄色の線)に合わせる。だいたい合わせてから「吸着」で近くのいちばん合う位置に寄せる
3. 青い縦棒で使う範囲を決めて「書き出す」

1. Choose a video and a song (or drop them). The video's own audio is not used
2. Drag the “Video” lane so the motion peaks (cyan) line up with the beats (yellow lines), then press “Snap”
3. Choose the range with the blue bars and press “Export”

## 対応環境と制限 / Support and limitations

| | |
|---|---|
| 書き出し | PC と Android の Chrome / Edge。Safari(iPhone)と Firefox は書き出しに対応していません(理由を画面に表示します) |
| 動画 | H.264 / H.265。H.265 はブラウザと端末が対応している場合のみ。HDR の動画は SDR に変換され、元より少し暗くなります |
| 拍の検出 | BPM 80〜160 を想定。それより速い / 遅い曲では拍線が半分 / 倍の間隔になります |
| 保存 | 設定はブラウザ内(IndexedDB)に自動保存。別の端末へは「JSON 保存」で移せます |

- **プライバシー**: 動画と曲はブラウザの中だけで処理し、どこにも送信しません。アクセス解析も入れていません
- **Privacy**: Your video and song are processed only in your browser and are never uploaded. There is no analytics
- 不具合の報告・要望 / Bug reports: [Issues](https://github.com/lsetzl/DanceClipWeb/issues)
- 書き出しに問題があるときの診断ページ / Diagnostics: https://lsetzl.github.io/DanceClipWeb/poc.html

## 開発 / Development

```
npm install
npm run dev
```

`main` へ push すると GitHub Actions が GitHub Pages にデプロイします。

| パス | 役割 |
|---|---|
| `src/app/` | 画面(同期再生エンジンは `player.ts`、タイムラインは `timeline.ts`) |
| `src/export.ts` | 書き出し(WebCodecs + Mediabunny + OfflineAudioContext) |
| `src/dsp/` | 解析。librosa の onset / tempo / beat_track、scipy の butter + sosfiltfilt、ffmpeg のリサンプラーの移植 |
| `src/analysis/` | 解析用の Web Worker と、IndexedDB へのキャッシュ |
| `poc.html` | 書き出しだけを試す診断ページ(AAC エンコーダーの遅延、出力遅延の表示) |
| `tests/dsp.test.ts` | 解析のテスト(`npm test`、CI でも実行)。合成信号に対するデスクトップ版(librosa / scipy / ffmpeg)の結果と一致するかを確かめる。正解データは `tools/make_fixtures.py` で作る |
| `tests/dsp-compare.ts` | 実際の曲でのデスクトップ版との突き合わせ(手元用。`npx tsx tests/dsp-compare.ts <name> [song]`) |
| `public/sw.js` | オフライン用の Service Worker。キャッシュするファイルの一覧はビルド時に `precache.json` として作る |
| `tools/make_icons.py` | アイコンと SNS 共有用の画像を作る |
| `tools/` | 書き出し結果の比較(音ズレ、SSIM)、デスクトップ版の解析結果の書き出し |

計測用の `/__test` エンドポイントと `window.dcTest` は dev サーバー専用で、ビルドには含まれません。手元のファイルを読ませるフォルダは `test-roots.local.json`(git 管理外、絶対パスの配列)に書きます。

検証結果は [POC_RESULTS.md](POC_RESULTS.md)。

## ライセンス / License

MIT([LICENSE](LICENSE))。同梱している第三者ソフトウェアのライセンスは [public/THIRD_PARTY_LICENSES.txt](public/THIRD_PARTY_LICENSES.txt)(公開ページでは `THIRD_PARTY_LICENSES.txt`)。
