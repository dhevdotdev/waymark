import { type GitError, git, native } from "../platform";
import { EXPLAIN, el } from "./git-panel-parts";

export interface NoticeContext {
  busy: boolean;
  remoteUrl: string | null;
  /** The panel's main actions already offer the terminal, so the notice need not repeat it. */
  terminalOffered: boolean;
  sync: () => void;
  toast: (message: string) => void;
}

function credentialForm(remoteUrl: string, context: NoticeContext): HTMLElement {
  const form = el("form", "notice cred-form");
  form.innerHTML = `<strong>HTTPS credentials</strong><p>Stored by git\u2019s credential helper in your macOS Keychain. Waymark does not keep a copy. For most hosts the password is a personal access token.</p>`;
  const user = el("input");
  user.placeholder = "Username";
  user.autocomplete = "username";
  const secret = el("input");
  secret.type = "password";
  secret.placeholder = "Password or token";
  secret.autocomplete = "current-password";
  const save = el("button", "btn btn-primary btn-small", "Save and sync");
  save.type = "submit";
  form.append(user, secret, save);
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (!user.value || !secret.value) return;
    try {
      await git.storeCredential(remoteUrl, user.value, secret.value);
      secret.value = "";
      context.sync();
    } catch (err) {
      context.toast((err as Error).message);
    }
  };
  setTimeout(() => user.focus());
  return form;
}

/** What went wrong, in plain words, with the next step when there is one. */
export function gitNotice(error: GitError, context: NoticeContext): HTMLElement {
  const info = EXPLAIN[error.kind] ?? EXPLAIN.other;
  const box = el("div", `notice is-${error.kind === "offline" || error.kind === "notARepo" ? "quiet" : "warn"}`);
  box.setAttribute("role", "status");
  box.append(el("strong", "", info.title));
  if (info.body) box.append(el("p", "", info.body));
  if (error.message && error.kind !== "notARepo") {
    const details = el("details", "notice-details");
    details.append(el("summary", "", "Git output"), el("pre", "", error.message));
    details.open = error.kind === "other";
    box.append(details);
  }
  const row = el("div", "notice-actions");
  if (info.retry) {
    const b = el("button", "btn btn-small", info.retry);
    b.disabled = context.busy;
    b.onclick = context.sync;
    row.append(b);
  }
  if ((info.terminal || error.kind === "other") && !context.terminalOffered) {
    const b = el("button", "btn btn-small", "Open in Terminal");
    b.onclick = () => void native.openTerminal();
    row.append(b);
  }
  const { remoteUrl } = context;
  if (error.kind === "auth" && remoteUrl?.startsWith("https://")) {
    const b = el("button", "btn btn-small", "Save credentials in Keychain");
    b.onclick = () => box.replaceWith(credentialForm(remoteUrl, context));
    row.append(b);
  }
  if (row.childElementCount) box.append(row);
  return box;
}
