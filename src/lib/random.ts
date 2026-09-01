/** Inclusive on both ends, like Python's random.randint. */
export function randomInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

/** Standard normal via Box–Muller. */
export function standardNormal(): number {
  let u = Math.random();
  let v = Math.random();
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Gamma via Marsaglia–Tsang; `shape < 1` uses the boost trick. */
export function gammaSample(shape: number): number {
  if (shape < 1) {
    return gammaSample(shape + 1) * Math.random() ** (1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    const x = standardNormal();
    const v = (1 + c * x) ** 3;
    if (v <= 0) continue;
    const u = Math.random();
    if (Math.log(u) < 0.5 * x * x + d - d * v + d * Math.log(v)) {
      return d * v;
    }
  }
}

export function betaSample(a: number, b: number): number {
  const ga = gammaSample(a);
  const gb = gammaSample(b);
  return ga / (ga + gb);
}
