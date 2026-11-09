/**
 * Removes Obsidian `%%comments%%` outside code. Fenced blocks and inline code
 * spans are preserved verbatim, since `%%` is common in printf format strings.
 * A comment's line breaks stay, so every other line keeps its number in the file.
 */
export function stripComments(markdown: string): string {
  const parts = markdown.split(/(^ {0,3}(?:```|~~~)[^\n]*\n[\s\S]*?^ {0,3}(?:```|~~~)[ \t]*$)/m);
  return parts
    .map((part, i) => {
      if (i % 2 === 1) return part;
      const spans: string[] = [];
      const masked = part.replace(/(`+)[\s\S]*?\1/g, (m) => {
        spans.push(m);
        return `\u0000${spans.length - 1}\u0000`;
      });
      const withoutComments = masked.replace(/%%[\s\S]*?%%/g, (comment) => comment.replace(/[^\n]/g, ""));
      // biome-ignore lint/suspicious/noControlCharactersInRegex: NUL cannot appear in note text, so it safely delimits placeholders.
      return withoutComments.replace(/\u0000(\d+)\u0000/g, (_, n) => spans[Number(n)]);
    })
    .join("");
}
