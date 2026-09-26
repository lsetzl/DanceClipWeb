# DanceClip Web

Sync a silent dance video with a song, trim it, add fades, and export an MP4 — entirely in your browser.
Your video and song never leave your device.

無音のダンス動画と曲を同期し、トリムとフェードをかけて MP4 に書き出すツールです。処理はすべてブラウザ内で行い、動画と曲はどこにも送信しません。

**https://lsetzl.github.io/DanceClipWeb/**

- 推奨ブラウザ / Recommended: Chrome, Edge (PC / Android)
- 書き出し / Export: WebCodecs (H.264 14Mbps + AAC 192kbps) + [Mediabunny](https://mediabunny.dev/)
- 設定はブラウザ内(IndexedDB)に自動保存。JSON での保存 / 読み込みも可能(デスクトップ版の JSON も読める)

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
| `poc.html` | 書き出しだけを試すページ |
| `tests/dsp-compare.ts` | デスクトップ版(Python)の解析結果との突き合わせ(`npx tsx tests/dsp-compare.ts <name> [song]`) |
| `tools/` | 書き出し結果の比較(音ズレ、SSIM)、デスクトップ版の解析結果の書き出し |

計測用の `/__test` エンドポイントと `window.dcTest` は dev サーバー専用で、ビルドには含まれません。手元のファイルを読ませるフォルダは `test-roots.local.json`(git 管理外、絶対パスの配列)に書きます。

検証結果は [POC_RESULTS.md](POC_RESULTS.md)。

## ライセンス / License

MIT([LICENSE](LICENSE))。同梱している第三者ソフトウェアのライセンスは [public/THIRD_PARTY_LICENSES.txt](public/THIRD_PARTY_LICENSES.txt)(公開ページでは `THIRD_PARTY_LICENSES.txt`)。
