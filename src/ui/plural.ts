/** "1 note", "2 notes", "1,204 notes". */
export const plural = (n: number, word: string): string => `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;
