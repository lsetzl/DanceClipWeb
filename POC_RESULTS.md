# PoC 結果: WebCodecs での書き出し(2026-09-26)

実装: `src/export.ts`(Mediabunny 1.60.0 + WebCodecs + OfflineAudioContext)、計測ページ: `index.html` / `src/poc.ts`、比較: `tools/compare.py`、`tools/quality.py`

## 結論
WebCodecs 方式で実用になる。同期・長さ・フェードは CLI版と一致し、画質は 14Mbps で CRF18 と同等、速度は実時間の約5倍。ffmpeg.wasm の互換モードは今のところ不要。

## 計測(234412: 46秒のクリップ、Edge 153 / Windows 11)

| 設定 | 書き出し時間 | サイズ | SSIM(元動画比) | PSNR |
|---|---|---|---|---|
| **x264 CRF18 medium(基準。VFR のまま)** | — | 52MB (9.0Mbps) | 0.9923 | 42.6dB |
| WebCodecs 14Mbps(HW) | **8.5s** | 86MB | **0.9923** | 40.3dB |
| WebCodecs 12Mbps(HW) | 8.2s | 74MB | 0.9911 | 40.1dB |
| WebCodecs quantizer 20 | 7.8s | 62MB | 0.9895 | 40.0dB |
| WebCodecs 10Mbps(HW) | — | 60MB | 0.9890 | 39.9dB |
| WebCodecs 14Mbps(SW 指定) | — | 81MB | 0.9832 | 39.2dB |

- SSIM は元動画とフレーム番号で対応させ、フェードを除いた 1200 フレームで測った。CLI版の出力との直接比較は、CLI版が VFR(約30.3fps)を 30fps CFR に変換してフレームを間引いているため、1コマずれて不正確になる
- 既定(`no-preference`)はハードウェアエンコーダーが選ばれる(14Mbps で HW 指定とバイト数が一致)
- 内蔵ブラウザのペインが非表示のときは約75秒かかった(非表示タブの間引き)。**書き出し中はタブを前面に置く必要がある**。UI で注意を出すか、Worker に移して影響を調べる

## 同期・長さ・フェード(CLI版の出力との比較)

| project | 曲 | 音の位置ズレ | 相関 | 映像の長さ web / cli |
|---|---|---|---|---|
| 234412 | m4a | **0.00ms** | 0.998 | 46.00s / 46.07s |
| 224844 | mp3 | **0.00ms** | 0.998 | 45.00s / 45.03s |
| 232706 | mp3(48kHz) | **0.00ms** | 0.998 | 41.00s / 41.03s |

- mp3 の `decodeAudioData` と ffmpeg のデコード差はない。同期値は CLI版 / GUI版とそのまま互換
- 音のフェード: 先頭と末尾の RMS 比が 0.98〜1.05 で一致
- 映像のフェード: 30 フレームで CLI版と明るさが揃う。フェード中は Web版が数%暗い(canvas の RGB で黒を重ねるため。ffmpeg は YUV で処理)。見た目の差はない
- CLI版は先頭フレームが黒くなっていない(CFR 変換の副作用)。Web版は正しく黒から始まる

## Web版の書き出しの仕様(CLI版との違い)
- 元のフレームをすべて残す(VFR のまま)。タイムスタンプは `元の時刻 - トリム開始`。最初のフレームだけ 0 に寄せる
- フェードのフレームだけ canvas に描いて黒を重ね、ほかはデコードしたフレームをそのままエンコーダーに渡す
- 回転: `rotation` が null なら元の回転タグを引き継ぐ。指定時は ffmpeg の反時計回りの値を時計回りに変換して、出力のメタデータに書く(未検証)

## 既定値の提案
- 映像 **14Mbps**(CRF18 と同じ SSIM)。サイズを気にするなら 12Mbps でも差は小さい
- 音声 AAC 192kbps

## 未検証・残り
- 回転の上書き(`VID_20260925_093536.mp4`)
- HEVC の入力
- Chrome 本体(Edge と同じ Chromium なので同等の見込み)
- 90秒の通し再生での映像と音のズレ(§9 の同期エンジン。UI 移植時に測る)

## ユーザーとの決定事項(2026-09-26)
- 映像の既定ビットレートは 14Mbps。ffmpeg.wasm は入れない
- リポジトリは公開(`lsetzl/DanceClipWeb`)、GitHub Pages で配信
- UI は日本語 + 英語(`src/i18n.ts`)。「〜のだ」口調はやめる
- スマホ対応する(スマホでの書き出しは実時間の 1.6 倍速で実用範囲)
- ライセンスは MIT。同梱ライブラリのライセンスは `public/THIRD_PARTY_LICENSES.txt` で表示する
- `HANDOFF_WEB.md` は個人のパスを含むので git に入れない(ローカルにだけ置く)
- 縦動画は縦のまま、横動画は横のまま書き出す。縦横を変える切り抜き機能は作らない

# UI 移植の検証(2026-09-26)

## 解析(デスクトップ版の Python / librosa と比較)
| 項目 | 結果 |
|---|---|
| onset 強度 | 最大差 0.001(相関 1.0) |
| BPM(全体・位置別 5 か所) | 2 曲とも完全一致 |
| 拍 | BRAVE FIGHTER 624 / 624、SAVE YOUR HEART 611 / 611 がずれ 0 |
| 吸着(beat_lock) | 2 曲 × 5 位置で移動量・相関とも一致 |
| 動きエネルギー | 長さ一致(4518)、相関 0.995、スケール比 1.007 |

- 一致させるために必要だったこと: 曲を元のサンプルレートでデコードし、ffmpeg と同じ Kaiser 窓 sinc(filter_size=32、cutoff=0.97、β=9)で 22050Hz に変換する(`src/dsp/resample.ts`、ffmpeg の出力と SNR 115〜144dB)。ステレオは ffmpeg の `-ac 1` と同じく (L+R)/√2
- ブラウザの OfflineAudioContext でリサンプルした場合は、拍が 3 か所で 40ms 以上ずれた
- 解析時間(PC): 曲 4.6 秒。動きエネルギーは動画 90 秒で十数秒(IndexedDB にキャッシュ)

## 再生中の映像と音のズレ(Edge 153、234412)
| 速度 | 区間 | 最大 | 平均 | 再同期 |
|---|---|---|---|---|
| 1x | 90 秒通し | 6.7ms | 3.8ms | 0 回 |
| 0.75x | 11 秒 | 1.4ms | 0.4ms | 0 回 |
| 0.5x | 10 秒 | 4.3ms | 2.5ms | 0 回 |
| 0.25x | 4 秒 | 2.0ms | 1.4ms | 0 回 |

## 画面からの書き出し
- OPFS 経由(Android と同じ経路)で 85.6MB、CLI 版との音ズレ 0.00ms、SSIM 0.9923(PoC と同じ)

# Android で音声が遅れる問題(2026-09-27)
- 原因: Android Chrome の AAC エンコーダー(MediaCodec)は先頭に priming を 2048 サンプル(44.1kHz で 46.4ms)付ける。Windows(Media Foundation)は 0。Web 版の MP4 に edit list がなかったため、Android で書き出すと音が約 46ms 遅れていた(Android 10 / Chrome 153 で実測。poc.html の「音声の遅延を測る」)
- 対処: 書き出しの直前に、そのブラウザのエンコーダーの priming をエンコード → デコードの往復で実測し(`src/audioDelay.ts`)、音声の開始時刻を `-priming / サンプルレート` にする。Mediabunny が edit list(media_time = priming)を書き、再生時に飛ばされる。CLI 版(ffmpeg)の出力と同じ形
- 検証(Windows): priming を 2048 と仮定すると edit list が入り、音が 46.5ms 早くなる(仕組みの確認)。実測に任せると edit list なしで CLI 版とのずれ 0.00ms
- Android のプレビュー: 本体スピーカーで outputLatency=40ms と getOutputTimestamp の実測 38.6ms がほぼ一致。Bluetooth 機器では確認していない
- Android 実機で書き出し直して、音の遅れがなくなったことをユーザーが確認(2026-09-27、耳での確認)

# 公開に向けた確認(2026-09-27)
| 入力 | 結果(PC / 内蔵ブラウザ) |
|---|---|
| HEVC 8bit SDR | 書き出し・動きの解析とも OK。色は元とほぼ同じ(輝度の平均差 0.1) |
| HEVC 10bit HDR(HLG / PQ) | 以前は「Encoding error」で失敗 → HDR / 10bit のフレームは canvas で SDR にしてから渡すように修正。ただし Chrome の HDR → SDR 変換で元より約 3 割暗くなる(SDR の白を 203nit に置いたテスト動画で、輝度の平均 85 / 元 117)。読み込み時に案内を出す。直すなら WebGL で自前のトーンマッピングが必要 |
| 4K 60fps H.264 | 書き出し OK。14Mbps を指定してもハードウェアエンコーダーは約 36Mbps で出力(SSIM 0.992) |
| 回転タグ付きの縦動画 | フェード部分の向きが崩れていたのを修正済み(4 パターンで相関 1.000) |
| 音声付きの動画 | 動画の音声は使わない旨を案内 |
| 非対応ブラウザ | 書き出しの前に理由を表示 |
