import "./styles/app.css";
import { isDesktop } from "./platform";
import { App } from "./ui/app";
import { guardDrops } from "./ui/drop-guard";
import { installScrollbars } from "./ui/scrollbars";
import { devVaultSource } from "./vault/source";

const root = document.getElementById("app")!;
const params = new URLSearchParams(location.search);
const app = new App(root);
installScrollbars();
guardDrops();
(window as unknown as { waymark: App }).waymark = app;

async function boot(): Promise<void> {
  if (!isDesktop) return app.start(devVaultSource(), params.get("note") ?? undefined);
  const { invoke } = await import("@tauri-apps/api/core");
  const selftest = await invoke<{ vault: string; mode: string } | null>("selftest_config");
  if (!selftest) return app.start();
  const log = (line: string) => void invoke("selftest_log", { line });
  window.addEventListener("error", (e) => log(`error: ${e.message}`));
  window.addEventListener("unhandledrejection", (e) => log(`rejection: ${String(e.reason)}`));
  document.addEventListener("securitypolicyviolation", (e) =>
    log(`csp: ${e.violatedDirective} blocked ${e.blockedURI} (policy: ${e.originalPolicy.slice(0, 400)})`),
  );
  log("starting");
  await app.start(undefined, undefined, selftest.vault, selftest.mode.startsWith("relaunch"));
  log(`started: ${JSON.stringify(app.metrics)}`);
  const { runSelfTest } = await import("./selftest");
  await invoke("selftest_report", { report: await runSelfTest(app, selftest.mode, log) });
}

boot().catch((err: Error) => {
  const box = document.createElement("div");
  box.className = "fatal";
  box.textContent = `The vault could not be opened: ${err.message}`;
  root.replaceChildren(box);
});
