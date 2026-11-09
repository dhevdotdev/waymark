// Signs the built app with a stable local identity and puts it in /Applications, then reopens it.
// macOS ties folder permissions to the signature, so an identity that survives rebuilds keeps them granted.
// Usage: node scripts/install-app.mjs   (after `pnpm tauri build --bundles app`)
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const BUILT = path.join(ROOT, "src-tauri/target/release/bundle/macos/Waymark.app");
const INSTALLED = "/Applications/Waymark.app";
const STATE = path.join(homedir(), ".local/state/waymark-signing");
const KEYCHAIN = path.join(STATE, "waymark.keychain-db");
const PASSWORD_FILE = path.join(STATE, "keychain-password");
const IDENTITY = "Waymark Local Signing";

const run = (command, ...args) =>
  execFileSync(command, args, { stdio: ["ignore", "pipe", "pipe"] })
    .toString()
    .trim();
const quiet = (command, ...args) => {
  try {
    return run(command, ...args);
  } catch {
    return null;
  }
};

function createIdentity(password) {
  const work = mkdtempSync(path.join(tmpdir(), "waymark-signing-"));
  try {
    const config = path.join(work, "cert.cnf");
    writeFileSync(
      config,
      `[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=${IDENTITY}\n[ext]\nbasicConstraints=critical,CA:false\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=critical,codeSigning\n`,
    );
    const key = path.join(work, "key.pem");
    const cert = path.join(work, "cert.pem");
    const bundle = path.join(work, "identity.p12");
    run(
      "/usr/bin/openssl",
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "7300",
      "-keyout",
      key,
      "-out",
      cert,
      "-config",
      config,
    );
    run(
      "/usr/bin/openssl",
      "pkcs12",
      "-export",
      "-inkey",
      key,
      "-in",
      cert,
      "-out",
      bundle,
      "-passout",
      `pass:${password}`,
      "-name",
      IDENTITY,
    );
    run("security", "create-keychain", "-p", password, KEYCHAIN);
    run("security", "set-keychain-settings", KEYCHAIN);
    run("security", "unlock-keychain", "-p", password, KEYCHAIN);
    run("security", "import", bundle, "-k", KEYCHAIN, "-P", password, "-T", "/usr/bin/codesign");
    run("security", "set-key-partition-list", "-S", "apple-tool:,apple:,codesign:", "-s", "-k", password, KEYCHAIN);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function signingIdentity() {
  mkdirSync(STATE, { recursive: true, mode: 0o700 });
  if (!existsSync(PASSWORD_FILE)) {
    writeFileSync(PASSWORD_FILE, randomBytes(24).toString("hex"), { mode: 0o600 });
    chmodSync(PASSWORD_FILE, 0o600);
  }
  const password = readFileSync(PASSWORD_FILE, "utf8");
  if (!existsSync(KEYCHAIN)) createIdentity(password);
  run("security", "unlock-keychain", "-p", password, KEYCHAIN);
  const certificate = run("security", "find-certificate", "-c", IDENTITY, "-Z", KEYCHAIN);
  return /SHA-1 hash: ([0-9A-F]+)/.exec(certificate)[1];
}

if (!existsSync(BUILT)) throw new Error("Build the app first: pnpm tauri build --bundles app");
const identity = signingIdentity();
run("codesign", "--force", "--deep", "--sign", identity, "--keychain", KEYCHAIN, BUILT);
run("codesign", "--verify", "--deep", BUILT);

quiet("osascript", "-e", 'tell application "Waymark" to quit');
const deadline = Date.now() + 10_000;
while (quiet("pgrep", "-f", `${INSTALLED}/Contents/MacOS/`) && Date.now() < deadline) execFileSync("sleep", ["0.25"]);
if (quiet("pgrep", "-f", `${INSTALLED}/Contents/MacOS/`)) throw new Error("Waymark did not quit, so it was left in place.");

const incoming = `${INSTALLED}.new`;
rmSync(incoming, { recursive: true, force: true });
cpSync(BUILT, incoming, { recursive: true, verbatimSymlinks: true });
rmSync(INSTALLED, { recursive: true, force: true });
renameSync(incoming, INSTALLED);
run("open", INSTALLED);
console.log(`Installed. ${run("codesign", "--display", "--requirements", "-", INSTALLED)}`);
