export const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;

export function fmt(sec: number | null | undefined, signed = false) {
  if (sec == null || !isFinite(sec)) return '--';
  const sign = sec < 0 ? '-' : signed ? '+' : '';
  const a = Math.abs(sec);
  const m = Math.floor(a / 60);
  const s = a - m * 60;
  return `${sign}${m}:${s.toFixed(3).padStart(6, '0')}`;
}

export function toast(msg: string, kind: '' | 'warn' | 'error' | 'ok' = '', ms = 3500) {
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), kind === 'error' ? Math.max(ms, 8000) : ms);
}

export function status(msg = '') {
  $('#statusText').textContent = msg;
  $('#stageStatus').textContent = msg;
  $('#stageStatus').classList.toggle('hidden', !msg);
}

export function loading(msg: string | null) {
  $('#loading').classList.toggle('hidden', !msg);
  if (msg) $('#loadingText').textContent = msg;
}

export function modal<T>(body: string, buttons: [string, T, string?][]): Promise<T> {
  return new Promise((resolve) => {
    $('#modalBody').textContent = body;
    const box = $('#modalBtns');
    box.innerHTML = '';
    for (const [label, value, cls] of buttons) {
      const b = document.createElement('button');
      b.textContent = label;
      if (cls) b.className = cls;
      b.onclick = () => {
        $('#modal').classList.add('hidden');
        resolve(value);
      };
      box.appendChild(b);
    }
    $('#modal').classList.remove('hidden');
  });
}

export function median(a: number[]) {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
}

export function percentile(arr: ArrayLike<number>, q: number) {
  const s = Float32Array.from(arr).sort();
  return s[Math.floor((s.length - 1) * q)] || 1;
}
