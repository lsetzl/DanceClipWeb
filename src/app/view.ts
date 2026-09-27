import { t } from '../i18n';
import { P, video } from './player';
import { beatMs, fadeGain, S, trimS, videoPosMs } from './state';
import { $, fmt } from './ui';

export function updateOverlay(tv: number) {
  $('#fadeOverlay').style.opacity = String(1 - fadeGain(tv));
  const tr = trimS();
  const out = !!tr && (tv < tr.start || tv > tr.end);
  const badge = $('#stageBadge');
  badge.classList.toggle('show', out);
  badge.textContent = out ? t('stage.outsideTrim') : '';
}

export function updateTransport() {
  $('#btnPlay').textContent = P.mode === 'linked' ? '❚❚' : '▶';
}

// 回転の選択肢と同じく、ffmpeg の表記(反時計回り)の角度
export const tagCcw = () => (360 - (S.vInfo?.rotation ?? 0)) % 360;

// 回転タグ(時計回り)は <video> が自動で反映する。上書き(ffmpeg と同じ反時計回りの値)との差だけ CSS で回す
export function rotationCss() {
  if (!S.p || S.p.rotation == null || !S.vInfo) return 0;
  const wantCw = (360 - (S.p.rotation % 360)) % 360;
  return (((wantCw - S.vInfo.rotation) % 360) + 360) % 360;
}

const narrow = window.matchMedia('(max-width: 900px)');
narrow.addEventListener('change', () => layoutVideo());
window.addEventListener('resize', () => layoutVideo());

export function layoutVideo() {
  const stage = $('#stage');
  let vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) return;
  const r = rotationCss();
  const swap = r % 180 !== 0;
  const visW = swap ? vh : vw, visH = swap ? vw : vh;
  // スマホでは枠の高さを動画の縦横比に合わせる(縦動画は画面の高さの 40% まで)
  if (narrow.matches && $('#welcome').classList.contains('hidden')) {
    stage.style.aspectRatio = 'auto';
    stage.style.height = `${Math.round(Math.min((stage.clientWidth * visH) / visW, window.innerHeight * 0.4))}px`;
  } else {
    stage.style.aspectRatio = '';
    stage.style.height = '';
  }
  const W = stage.clientWidth, H = stage.clientHeight;
  const s = Math.min(W / visW, H / visH);
  vw *= s;
  vh *= s;
  Object.assign(video.style, {
    width: `${vw}px`,
    height: `${vh}px`,
    left: `${(W - vw) / 2}px`,
    top: `${(H - vh) / 2}px`,
    transform: `rotate(${r}deg)`,
  });
}

function setInput(sel: string, v: number | string) {
  const el = $<HTMLInputElement>(sel);
  if (document.activeElement !== el) el.value = String(v);
}

export function updatePanels() {
  const p = S.p;
  if (!p) return;
  const pos = videoPosMs();
  setInput('#inOffset', pos);
  $('#offsetDesc').textContent = pos >= 0 ? t('sync.videoStartsAt', { t: fmt(pos / 1000) }) : t('sync.songStartsAt', { t: fmt(-pos / 1000) });
  const bpm = S.localBpm || S.bpm;
  $('#bpmInfo').textContent = bpm ? t('sync.bpm', { bpm: bpm.toFixed(1), ms: beatMs() }) : t('sync.bpmPending');
  if (p.trim.start_ms != null && p.trim.end_ms != null) {
    setInput('#inStart', p.trim.start_ms);
    setInput('#inEnd', p.trim.end_ms);
    $('#trimDur').textContent = t('trim.length', { t: fmt((p.trim.end_ms - p.trim.start_ms) / 1000) });
  }
  $('#barInfo').textContent = p.bar_phase == null ? t('bar.auto') : t('bar.manual');
  $('#btnBarAuto').classList.toggle('hidden', p.bar_phase == null);
  setInput('#inFadeIn', p.fade.in_ms);
  setInput('#inFadeOut', p.fade.out_ms);
  $<HTMLSelectElement>('#selRotation').value = p.rotation == null ? 'auto' : String(p.rotation);
  $('#rotInfo').textContent = p.rotation == null ? t('rot.keepTag', { deg: tagCcw() }) : t('rot.override');
  S.dirty = true;
}

export function updateSourceInfo() {
  $('#videoName').textContent = t('top.none');
  $('#audioName').textContent = t('top.none');
  const v = S.vInfo;
  if (v && S.videoFile) {
    $('#videoName').textContent = S.videoFile.name;
    $('#videoInfo').textContent =
      `${v.width}x${v.height} ${v.fps.toFixed(0)}fps ${v.codec ?? ''} ${fmt(S.vDur)}` + (v.rotation ? ` ${t('src.rotTag', { deg: tagCcw() })}` : '');
  }
  if (S.buffer && S.audioFile) {
    $('#audioName').textContent = S.audioFile.name;
    $('#audioInfo').textContent = `${S.buffer.numberOfChannels}ch ${fmt(S.aDur)}`;
  }
  $('#tVideoDur').textContent = S.vDur ? '/ ' + fmt(S.vDur) : '';
  $('#tSongDur').textContent = S.aDur ? '/ ' + fmt(S.aDur) : '';
}
