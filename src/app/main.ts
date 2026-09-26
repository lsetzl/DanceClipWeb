import '../messages';
import './messages';
import { applyI18n, lang, setLang, t, type Lang } from '../i18n';
import { addMarker, beatLock, changed, clampFades, nudge, setIn, setOut, setTrim } from './actions';
import { cancelRender, checkSupport, startRender } from './exporter';
import { classify, exportProjectJson, handleDrop, importProjectJson, openAudio, openVideo, pickFile, renderRecent, type Picked } from './media';
import { currentSongTime, currentVideoTime, P } from './player';
import { beatMs, RATES, ready, S, trimS } from './state';
import { draw, followPlayhead, initTimeline, resizeCanvases, V, viewFit, viewSong, viewTrim, zoomAt } from './timeline';
import { $, fmt } from './ui';
import { layoutVideo, updateOverlay, updatePanels, updateSourceInfo } from './view';

function tick() {
  if (P.mode !== 'stop' || S.dirty) {
    S.dirty = false;
    followPlayhead();
    $('#tVideo').textContent = fmt(currentVideoTime());
    $('#tSong').textContent = fmt(currentSongTime());
    if (P.mode !== 'linked') updateOverlay(currentVideoTime());
    $('#driftInfo').textContent =
      P.mode === 'linked' && P.drift != null
        ? t('drift', { ms: `${P.drift * 1000 >= 0 ? '+' : ''}${(P.drift * 1000).toFixed(0)}` }) + (P.resyncCount ? ' ' + t('drift.resync', { n: P.resyncCount }) : '')
        : '';
    draw();
  }
  requestAnimationFrame(tick);
}

function helpOpen() {
  return !$('#help').classList.contains('hidden');
}

function onKey(e: KeyboardEvent) {
  if (!$('#modal').classList.contains('hidden')) return;
  if (helpOpen()) {
    if (e.key === 'Escape' || e.key === '?') $('#help').classList.add('hidden');
    return;
  }
  const el = document.activeElement as HTMLElement | null;
  const tag = el?.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') {
    if (e.key === 'Escape' || e.key === 'Enter') el!.blur();
    return;
  }
  const k = e.key.toLowerCase();
  if (e.ctrlKey || e.metaKey) {
    if (k === 'o') {
      e.preventDefault();
      pickFile('project').then((r) => r && importProjectJson(r.file));
    } else if (k === 'e') {
      e.preventDefault();
      startRender();
    } else if (k === 's') {
      e.preventDefault();
      exportProjectJson();
    }
    return;
  }
  if (e.key === '?') {
    $('#help').classList.remove('hidden');
    return;
  }
  if (!ready()) return;
  const tr = trimS();
  switch (e.code) {
    case 'Space': P.toggle(); break;
    case 'ArrowLeft': P.seek(currentVideoTime() - (e.shiftKey ? 5 : 1)); break;
    case 'ArrowRight': P.seek(currentVideoTime() + (e.shiftKey ? 5 : 1)); break;
    case 'Comma': P.pause(); P.seek(currentVideoTime() - 1 / S.fps); break;
    case 'Period': P.pause(); P.seek(currentVideoTime() + 1 / S.fps); break;
    case 'KeyZ': nudge(e.shiftKey ? -50 : -10); break;
    case 'KeyX': nudge(e.shiftKey ? 50 : 10); break;
    case 'KeyC': nudge(-beatMs()); break;
    case 'KeyV': nudge(beatMs()); break;
    case 'KeyB': beatLock(); break;
    case 'KeyM': addMarker(currentVideoTime()); break;
    case 'KeyI': setIn(); break;
    case 'KeyO': setOut(); break;
    case 'KeyL': $('#chkLoop').click(); break;
    case 'KeyF': $('#chkFade').click(); break;
    case 'BracketLeft': P.setRate(RATES[Math.min(RATES.length - 1, RATES.indexOf(P.rate) + 1)]); break;
    case 'BracketRight': P.setRate(RATES[Math.max(0, RATES.indexOf(P.rate) - 1)]); break;
    case 'Home': if (tr) P.seek(tr.start); break;
    case 'End': if (tr) P.seek(Math.max(tr.start, tr.end - 3)); break;
    case 'Equal': case 'NumpadAdd': zoomAt(currentSongTime(), 0.7); break;
    case 'Minus': case 'NumpadSubtract': zoomAt(currentSongTime(), 1.4); break;
    case 'Digit0': case 'Numpad0': viewFit(); break;
    default: return;
  }
  e.preventDefault();
}


function numInput(sel: string, fn: (v: number) => void) {
  $(sel).addEventListener('change', (e) => {
    const v = Math.round(+(e.target as HTMLInputElement).value);
    if (!S.p || !isFinite(v)) return updatePanels();
    fn(v);
    updatePanels();
  });
}

async function onDrop(e: DragEvent) {
  e.preventDefault();
  document.body.classList.remove('dragging');
  const dt = e.dataTransfer;
  if (!dt) return;
  // getAsFileSystemHandle はイベント処理中に同期的に呼ぶ必要がある
  const handlePromises = [...dt.items]
    .filter((i) => i.kind === 'file')
    .map((i) => (i as DataTransferItem & { getAsFileSystemHandle?: () => Promise<FileSystemHandle | null> }).getAsFileSystemHandle?.() ?? Promise.resolve(null));
  const files = [...dt.files];
  const handles = await Promise.all(handlePromises.map((p) => p.catch(() => null)));
  const items: Picked[] = files.map((file, i) => {
    const h = handles[i];
    return { file, handle: h && h.kind === 'file' ? (h as FileSystemFileHandle) : null };
  });
  if (items.some((i) => classify(i.file))) handleDrop(items);
}

function wire() {
  $('#btnPickVideo').onclick = async () => openVideo(await pickFile('video'));
  $('#btnPickAudio').onclick = async () => openAudio(await pickFile('audio'));
  $('#welcomeVideo').onclick = () => $('#btnPickVideo').click();
  $('#welcomeAudio').onclick = () => $('#btnPickAudio').click();
  $('#btnImport').onclick = async () => {
    const r = await pickFile('project');
    if (r) importProjectJson(r.file);
  };
  $('#btnExportJson').onclick = exportProjectJson;
  $('#btnRecent').onclick = async (e) => {
    e.stopPropagation();
    await renderRecent();
    $('#recentMenu').classList.toggle('open');
  };
  document.addEventListener('click', () => $('#recentMenu').classList.remove('open'));
  $('#btnHelp').onclick = () => $('#help').classList.remove('hidden');
  $('#btnHelpClose').onclick = () => $('#help').classList.add('hidden');
  const langSel = $<HTMLSelectElement>('#lang');
  langSel.value = lang;
  langSel.onchange = () => {
    setLang(langSel.value as Lang);
    updatePanels();
    updateSourceInfo();
    renderRecent();
    S.dirty = true;
  };

  $('#btnPlay').onclick = () => P.toggle();
  $<HTMLSelectElement>('#selRate').onchange = (e) => P.setRate(+(e.target as HTMLSelectElement).value);
  $<HTMLInputElement>('#chkLoop').onchange = (e) => (S.loop = (e.target as HTMLInputElement).checked);
  $<HTMLInputElement>('#chkFade').onchange = (e) => {
    S.fadePreview = (e.target as HTMLInputElement).checked;
    if (P.mode === 'linked') P.scheduleFade();
    updateOverlay(currentVideoTime());
  };
  $<HTMLInputElement>('#volume').oninput = (e) => {
    if (P.master) P.master.gain.value = +(e.target as HTMLInputElement).value;
  };

  document.querySelectorAll<HTMLButtonElement>('[data-nudge]').forEach((b) => {
    b.onclick = () => {
      const v = b.dataset.nudge!;
      nudge(v === 'beat' ? beatMs() : v === '-beat' ? -beatMs() : +v);
    };
  });
  numInput('#inOffset', (v) => {
    S.p!.video_ref_ms = S.p!.audio_ref_ms - v;
    changed({ sync: true });
  });
  $('#btnLock').onclick = beatLock;
  $('#btnMarker').onclick = () => ready() && addMarker(currentVideoTime());
  $('#btnSetIn').onclick = () => ready() && setIn();
  $('#btnSetOut').onclick = () => ready() && setOut();
  $('#btnZoomSong').onclick = viewSong;
  $('#btnZoomFit').onclick = viewFit;
  $('#btnZoomTrim').onclick = viewTrim;
  $('#btnZoomIn').onclick = () => zoomAt(currentSongTime(), 0.7);
  $('#btnZoomOut').onclick = () => zoomAt(currentSongTime(), 1.4);

  numInput('#inStart', (v) => setTrim(v, S.p!.trim.end_ms!));
  numInput('#inEnd', (v) => setTrim(S.p!.trim.start_ms!, v));
  numInput('#inFadeIn', (v) => {
    S.p!.fade.in_ms = Math.max(0, v);
    clampFades();
    changed({ fade: true });
  });
  numInput('#inFadeOut', (v) => {
    S.p!.fade.out_ms = Math.max(0, v);
    clampFades();
    changed({ fade: true });
  });
  $<HTMLSelectElement>('#selRotation').onchange = (e) => {
    if (!S.p) return;
    const v = (e.target as HTMLSelectElement).value;
    S.p.rotation = v === 'auto' ? null : +v;
    layoutVideo();
    changed();
  };

  $('#btnRender').onclick = startRender;
  $('#btnRenderCancel').onclick = cancelRender;

  document.addEventListener('keydown', onKey);
  window.addEventListener('dragover', (e) => {
    e.preventDefault();
    document.body.classList.add('dragging');
  });
  window.addEventListener('dragleave', (e) => {
    if (!e.relatedTarget) document.body.classList.remove('dragging');
  });
  window.addEventListener('drop', onDrop);
  window.addEventListener('beforeunload', (e) => {
    if (S.rendering) e.preventDefault();
  });

  initTimeline();
  new ResizeObserver(() => {
    resizeCanvases();
    layoutVideo();
  }).observe(document.body);
  requestAnimationFrame(tick);
}

applyI18n();
updateSourceInfo();
wire();
renderRecent();
checkSupport().then((msg) => {
  if (!msg) return;
  $('#supportWarn').textContent = msg;
  $('#supportWarn').classList.remove('hidden');
});

if (import.meta.env.DEV) {
  const fetchFile = async (path: string) => {
    const r = await fetch('/__test/file?p=' + encodeURIComponent(path));
    if (!r.ok) throw new Error(`${r.status} ${path}`);
    return new File([await r.blob()], path.split(/[\\/]/).pop()!, { lastModified: 0 });
  };
  Object.assign(window, {
    dcTest: {
      S, P, V,
      openVideo: async (path: string) => openVideo({ file: await fetchFile(path), handle: null }),
      openAudio: async (path: string) => openAudio({ file: await fetchFile(path), handle: null }),
      drop: async (paths: string[]) => handleDrop(await Promise.all(paths.map(async (p) => ({ file: await fetchFile(p), handle: null })))),
    },
  });

  // 実ブラウザでの通し再生のズレ計測。?autotest=<name> で poc-out/jobs_<name>.json の設定を読む
  const auto = new URLSearchParams(location.search).get('autotest');
  if (auto) {
    (async () => {
      const job = await (await fetch('/__test/jobs?name=' + encodeURIComponent(auto))).json();
      const report: Record<string, unknown>[] = [];
      await openAudio({ file: await fetchFile(job.audio), handle: null });
      const opening = openVideo({ file: await fetchFile(job.video), handle: null });
      await new Promise((r) => setTimeout(r, 1500));
      if (!document.querySelector('#modal')!.classList.contains('hidden')) (document.querySelector('#modalBtns button') as HTMLButtonElement).click();
      await opening;
      Object.assign(S.p!, job.p);
      for (const run of job.runs) {
        P.setRate(run.rate);
        P.seek(run.from);
        await new Promise((r) => setTimeout(r, 800));
        const drifts: number[] = [];
        P.resyncCount = 0;
        const iv = setInterval(() => P.drift != null && drifts.push(P.drift * 1000), 200);
        await P.play();
        const t0 = performance.now();
        while (performance.now() - t0 < run.seconds * 1000 && P.mode === 'linked') await new Promise((r) => setTimeout(r, 250));
        clearInterval(iv);
        const end = currentVideoTime();
        P.pause();
        const abs = drifts.map(Math.abs);
        report.push({
          rate: run.rate, from: run.from, to: end, samples: drifts.length,
          maxAbsMs: Math.max(...abs), meanAbsMs: abs.reduce((a, b) => a + b, 0) / abs.length, resyncs: P.resyncCount,
        });
        await fetch(`/__test/save?name=result_${auto}.json`, { method: 'POST', body: JSON.stringify({ ua: navigator.userAgent, report }, null, 1) });
      }
      document.title = 'AUTOTEST DONE';
    })();
  }
}
