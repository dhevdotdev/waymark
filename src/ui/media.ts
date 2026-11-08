export const reducedMotion = (): boolean => matchMedia("(prefers-reduced-motion: reduce)").matches;
export const isNarrow = (): boolean => matchMedia("(max-width: 900px)").matches;
export const railFloats = (): boolean => matchMedia("(max-width: 1240px)").matches;
