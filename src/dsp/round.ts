// numpy.round / Python の round と同じ偶数丸め
export function roundHalfEven(x: number) {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}
