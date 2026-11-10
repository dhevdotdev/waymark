import { type GitError, git, native } from "../platform";

/**
 * First run, or no vault open: open an existing folder or clone a remote into
 * a folder the user picks. Any Git host works; credentials come from the
 * user's own Git setup.
 */
export function showWelcome(root: HTMLElement, recent: string[], onOpen: (path: string) => void, error?: string): void {
  root.innerHTML = `
    <div class="welcome" data-tauri-drag-region>
      <main class="welcome-page">
        <h1>Waymark</h1>
        <p class="welcome-lede">A quiet place to read your notes. Open a Markdown vault kept in Git, or clone one.</p>
        <div class="welcome-actions">
          <button class="btn btn-primary btn-large" data-w="open">Open a vault…</button>
          <button class="btn btn-large" data-w="clone">Clone from a remote…</button>
        </div>
        <form class="clone-form" hidden>
          <label>Remote URL<input name="url" type="text" spellcheck="false" autocomplete="off" placeholder="git@host:you/notes.git or https://…" required /></label>
          <label>Folder<span class="clone-dest"><input name="dest" type="text" spellcheck="false" placeholder="Choose where the vault will live" required /><button type="button" class="btn btn-small" data-w="pick">Choose…</button></span></label>
          <div class="clone-progress" aria-live="polite"></div>
          <div class="clone-buttons"><button type="button" class="btn" data-w="cancel">Cancel</button><button type="submit" class="btn btn-primary">Clone</button></div>
        </form>
        <p class="welcome-error" role="alert"></p>
        <section class="welcome-recent"></section>
      </main>
    </div>`;
  const q = <T extends HTMLElement>(s: string) => root.querySelector(s) as T;
  const errorEl = q<HTMLElement>(".welcome-error");
  errorEl.textContent = error ?? "";
  const form = q<HTMLFormElement>(".clone-form");
  const actions = q<HTMLElement>(".welcome-actions");
  const progress = q<HTMLElement>(".clone-progress");

  const recentBox = q<HTMLElement>(".welcome-recent");
  if (recent.length) {
    const h = document.createElement("div");
    h.className = "welcome-recent-label";
    h.textContent = "Recent";
    recentBox.append(h);
    for (const path of recent.slice(0, 5)) {
      const b = document.createElement("button");
      b.className = "welcome-recent-row";
      b.dataset.path = path;
      const name = document.createElement("span");
      name.textContent = path.split("/").pop() ?? path;
      const dir = document.createElement("span");
      dir.className = "welcome-recent-dir";
      dir.textContent = path.replace(/^\/Users\/[^/]+/, "~");
      b.append(name, dir);
      recentBox.append(b);
    }
  }

  root.querySelector(".welcome")!.addEventListener("click", async (e) => {
    const t = e.target as HTMLElement;
    const recentRow = t.closest<HTMLElement>(".welcome-recent-row");
    if (recentRow) return onOpen(recentRow.dataset.path!);
    const act = t.closest<HTMLElement>("[data-w]")?.dataset.w;
    if (act === "open") {
      const path = await native.pickFolder("Open a vault");
      if (path) onOpen(path);
    } else if (act === "clone") {
      actions.hidden = true;
      form.hidden = false;
      (form.elements.namedItem("url") as HTMLInputElement).focus();
    } else if (act === "cancel") {
      form.hidden = true;
      actions.hidden = false;
    } else if (act === "pick") {
      const parent = await native.pickFolder("Choose a parent folder");
      if (parent) {
        const url = (form.elements.namedItem("url") as HTMLInputElement).value;
        const name = /([^/:]+?)(?:\.git)?\/?$/.exec(url)?.[1] ?? "notes";
        (form.elements.namedItem("dest") as HTMLInputElement).value = `${parent.replace(/\/$/, "")}/${name}`;
      }
    }
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const url = (form.elements.namedItem("url") as HTMLInputElement).value.trim();
    const dest = (form.elements.namedItem("dest") as HTMLInputElement).value.trim();
    if (!url || !dest) return;
    errorEl.textContent = "";
    form.classList.add("is-busy");
    for (const el of form.querySelectorAll<HTMLInputElement | HTMLButtonElement>("input, button")) el.disabled = true;
    progress.textContent = "Connecting…";
    const stop = await native.onCloneProgress((line) => (progress.textContent = line));
    try {
      await git.clone(url, dest);
      onOpen(dest);
    } catch (err) {
      const ge = err as GitError;
      errorEl.textContent =
        ge.kind === "auth"
          ? "The remote refused access. Check that git in Terminal can clone this URL (SSH key loaded, or HTTPS credentials in Keychain)."
          : ge.kind === "offline"
            ? "The remote could not be reached. Check the URL and your connection."
            : ge.message;
      progress.textContent = "";
    } finally {
      stop();
      form.classList.remove("is-busy");
      for (const el of form.querySelectorAll<HTMLInputElement | HTMLButtonElement>("input, button")) el.disabled = false;
    }
  });
}
