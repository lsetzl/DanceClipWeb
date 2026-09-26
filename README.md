# DanceClip Web

Sync a silent dance video with a song, trim it, add fades, and export an MP4 — entirely in your browser.
Your video and song never leave your device.

無音のダンス動画と曲を同期し、トリムとフェードをかけて MP4 に書き出すツールです。処理はすべてブラウザ内で行い、動画と曲はどこにも送信しません。

- 推奨ブラウザ / Recommended: Chrome, Edge (PC)
- 書き出し / Export: WebCodecs (H.264 14Mbps + AAC 192kbps) + [Mediabunny](https://mediabunny.dev/)

## 開発 / Development

```
npm install
npm run dev
```

`main` へ push すると GitHub Actions が GitHub Pages にデプロイします。

計測用の `/__test` エンドポイントは dev サーバー専用です。手元のファイルを読ませるフォルダは `test-roots.local.json`(git 管理外、絶対パスの配列)に書きます。

PoC の結果は [POC_RESULTS.md](POC_RESULTS.md)。
