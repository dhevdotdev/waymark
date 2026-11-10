import { el } from "./git-panel-parts";

interface CommitBoxOptions {
  message: string;
  hasRemote: boolean;
  busy: boolean;
  onInput: (message: string) => void;
  commit: (message: string, share: boolean) => void;
}

/** The commit message and its buttons, the leading action last. Command-Return commits and, with a remote, syncs. */
export function commitBox({ message, hasRemote, busy, onInput, commit }: CommitBoxOptions): HTMLFormElement {
  const box = el("form", "commit-box");
  const msg = el("textarea");
  msg.placeholder = "Describe what changed";
  msg.rows = 3;
  msg.dataset.control = "message";
  msg.value = message;
  msg.addEventListener("input", () => onInput(msg.value));
  const send = (share: boolean) => {
    if (msg.value.trim()) commit(msg.value, share);
    else msg.focus();
  };
  const row = el("div", "commit-actions");
  if (hasRemote) {
    const localOnly = el("button", "btn", "Commit only");
    localOnly.type = "button";
    localOnly.dataset.control = "commit-only";
    localOnly.disabled = busy;
    localOnly.onclick = () => send(false);
    row.append(localOnly);
  }
  const publish = el("button", "btn btn-primary", hasRemote ? "Commit & Sync" : "Commit");
  publish.type = "submit";
  publish.dataset.control = "publish";
  publish.disabled = busy;
  row.append(publish);
  box.append(msg, row);
  box.onsubmit = (e) => {
    e.preventDefault();
    send(true);
  };
  msg.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.metaKey) {
      e.preventDefault();
      send(true);
    }
  });
  return box;
}
