const MAX_WAIT_MS = 200;

export interface ImageSize {
  width: number;
  height: number;
}

const known = new Map<string, ImageSize>();

function measure(url: string): Promise<void> {
  return new Promise((resolve) => {
    const probe = new Image();
    probe.onload = () => {
      if (probe.naturalWidth && probe.naturalHeight) known.set(url, { width: probe.naturalWidth, height: probe.naturalHeight });
      resolve();
    };
    probe.onerror = () => resolve();
    probe.src = url;
  });
}

export function knownImageSize(url: string): ImageSize | null {
  return known.get(url) ?? null;
}

/** Makes an image take its final size before its pixels arrive. A `|300` size written in the note wins over the file's own width. */
export function applyImageSize(image: HTMLImageElement, size: ImageSize): void {
  const written = Number(image.getAttribute("width"));
  image.style.setProperty("--iw", `${written || size.width}px`);
  image.style.setProperty("--ir", String(size.width / size.height));
  image.classList.add("is-sized");
}

/** Learns the size of every image under `root` before it is shown, so the page does not jump as they load. */
export async function reserveImageSpace(root: ParentNode): Promise<void> {
  const images = [...root.querySelectorAll<HTMLImageElement>("img[src]")];
  const unknown = [...new Set(images.map((image) => image.getAttribute("src")!))].filter((url) => !known.has(url));
  if (unknown.length)
    await Promise.race([Promise.all(unknown.map(measure)), new Promise((done) => setTimeout(done, MAX_WAIT_MS))]);
  for (const image of images) {
    const size = known.get(image.getAttribute("src")!);
    if (size) applyImageSize(image, size);
  }
}
