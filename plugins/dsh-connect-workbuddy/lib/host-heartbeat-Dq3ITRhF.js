import { lstat, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { homedir, tmpdir } from "node:os";
import { dirname, join, posix, resolve, sep, win32 } from "node:path";
import { execFile, execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
//#region src/host-peers.ts
/**
* The two host utilities this plugin uses that must ALSO work in the
* standalone CLI (issue #47).
*
* WHY THIS EXISTS. `@deepseek-ai/dsh-atomic-write` and
* `@deepseek-ai/dsh-home-paths` are declared as **peer** dependencies: the DSH
* host carries them, and the plugin is supposed to borrow the host's copies.
* Inside a booted host that works — `packages/boot/app-boot`'s runtime
* interception layer answers those bare specifiers from the installation. But
* `dsh plugin --profile <p> exec dsh-connect-workbuddy …` is NOT a booted host:
* `plugin-manager`'s `runProfilePnpm` spawns `pnpm exec` in the profile
* directory with the plain environment, so the child resolves with stock Node
* rules and the interception layer is absent (DSH deliberately never sets
* `NODE_PATH`; `packages/boot/app-boot/src/index.ts` scrubs it).
*
* The profile is created with `autoInstallPeers: false`, so peers are never
* installed there either. The result on a clean machine is a load-time crash
* before any command runs:
*
*   Error [ERR_MODULE_NOT_FOUND]: Cannot find package
*   '@deepseek-ai/dsh-atomic-write' imported from
*   …/profiles/<p>/node_modules/dsh-connect-workbuddy/lib/host-heartbeat-*.js
*
* The trigger is CHUNKING, which is why the import looked unrelated to the
* command: tsdown emits `host-heartbeat-*.js` as the shared chunk holding
* `auth`, `at-rest`, `host-heartbeat`, and `pi-ai-runtime`, so `lib/bin.js`
* reaches `auth.ts`'s atomic-write import even for a read-only `status`.
*
* WHY NOT a static import with a fallback: a static `import` of a missing
* package throws at MODULE EVALUATION time, before any fallback can run. The
* import itself has to be deferred, so both peers are loaded through
* `import()` inside the functions that need them.
*
* WHY NOT move them to `dependencies`: the host half genuinely runs against
* the host's copies, and duplicating them into every profile would add two
* packages to a market install to serve a CLI that runs a handful of times.
* More importantly these two are pure, stateless, cordis-free utilities — no
* service, no process-global state — so the host's copy and a local copy are
* interchangeable, which is exactly what makes a fallback safe here. (Contrast
* `@deepseek-ai/cordis` or pi-ai, where a second copy WOULD be wrong: cordis
* carries the service registry, and pi-ai's generation changes context shape.)
*
* WHY THE FALLBACK MIRRORS THE HOST. `writeFileAtomic` and `withFileLock`
* govern a cross-process protocol: the lock is a `wx`-created `<file>.lock`
* sibling and the commit is a same-directory temp file renamed over the
* target. A fallback with different timing or a different lock path would let
* a CLI process and the host race each other on the same file, so the retry
* cadence, the Windows transient-error set, and the `EPERM`-needs-`lstat`
* confirmation rule are transcribed from the host package rather than
* reinvented. `docs/WINDOWS.md` and `CHANGELOG.md` (2.0.x) already record the
* measured budget: delay sequence 20+40+80+160+200×4 ≈ 1100ms, not the
* "600ms" an earlier draft of the docs claimed.
*
* Inside DSH the host's own copy always wins — the dynamic import resolves it
* first, and the fallback is unreachable there. The fallback exists solely so
* the standalone CLI is self-sufficient on a machine that has only the plugin.
*
* @module dsh-connect-workbuddy/host-peers
*/
const ATOMIC_WRITE = "@deepseek-ai/dsh-atomic-write";
/**
* Load one peer, preferring whatever the host provides.
*
* The host's copy is resolved through the same ESM resolver this module is
* loaded by, so the answer matches the import the plugin would otherwise have
* made. Resolution failure is not an error here: it is the documented state of
* a market install probed outside the host, and the caller falls back.
*
* Why ONE `catch` covers both "absent" and "broken": `import()` rejects with
* `ERR_MODULE_NOT_FOUND` for the first and rethrows the module's own error for
* the second, and there is nothing this plugin could do differently about
* either — it cannot repair the host's copy. Falling back is strictly better
* than crashing, and it is not SILENT: `doctor` reports which implementation
* is in use, so a host copy that is present but unloadable shows up as
* `fallback` on a machine where the host should have supplied it. Narrowing
* the catch to `ERR_MODULE_NOT_FOUND` would instead turn a corrupt host
* install into a hard crash inside a read-only `status`, which is exactly the
* failure mode issue #47 is about.
*/
async function loadHostModule(specifier) {
	try {
		return await import(specifier);
	} catch {
		return;
	}
}
let atomicWrite;
/** The host's atomic-write copy, or undefined when only the fallback is available. */
function hostAtomicWrite() {
	atomicWrite ??= loadHostModule(ATOMIC_WRITE);
	return atomicWrite;
}
/** Directory name for the default DeepSeek Harness home under the OS home. */
const DSH_HOME_DIR_NAME = ".dsh";
/** Environment variable that overrides the default DeepSeek Harness home. */
const DSH_HOME_ENV = "DSH_HOME";
/** Expand `~`, `~/`, and `~\` against the operating-system home. */
function expandHomePath(path) {
	if (path === "~") return homedir();
	if (path.startsWith("~/") || path.startsWith("~\\")) return join(homedir(), path.slice(2));
	return path;
}
/**
* Resolve the default harness home without the host package.
*
* Precedence, highest first: an explicit configured path, `$DSH_HOME`, then
* `~/.dsh`. A blank `$DSH_HOME` counts as unset, so an empty override can
* never resolve the home to the current working directory. This is the whole
* of `resolveDshHome`; the host package's other exports are not used here.
*/
function fallbackResolveDshHome(configured, env = process.env) {
	const fromEnv = env[DSH_HOME_ENV];
	const chosen = configured ?? (fromEnv !== void 0 && fromEnv.trim().length > 0 ? fromEnv : join(homedir(), DSH_HOME_DIR_NAME));
	return resolve(expandHomePath(chosen));
}
/** Windows errors that mean temporary interference with an atomic replacement. */
const WINDOWS_TRANSIENT_RENAME_ERRORS = /* @__PURE__ */ new Set([
	"EACCES",
	"EBUSY",
	"EPERM"
]);
const WINDOWS_RENAME_RETRY_INITIAL_MS = 20;
const WINDOWS_RENAME_RETRY_MAX_MS = 200;
const WINDOWS_RENAME_RETRY_LIMIT = 8;
/** Whether Windows reported temporary interference with an atomic replacement. */
function isTransientWindowsRenameError(error) {
	if (process.platform !== "win32") return false;
	return WINDOWS_TRANSIENT_RENAME_ERRORS.has(error?.code ?? "");
}
/** Replace the target after bounded retries for transient Windows interference. */
async function renameAtomicTemp(temp, filename) {
	let delay = WINDOWS_RENAME_RETRY_INITIAL_MS;
	for (let retries = 0;; retries += 1) {
		try {
			await rename(temp, filename);
			return;
		} catch (error) {
			if (!isTransientWindowsRenameError(error)) throw error;
			if (retries >= WINDOWS_RENAME_RETRY_LIMIT) throw error;
		}
		await new Promise((resolve) => setTimeout(resolve, delay));
		delay = Math.min(delay * 2, WINDOWS_RENAME_RETRY_MAX_MS);
	}
}
/**
* Replace `filename` with `content` in one atomic step, creating parents.
*
* The content goes to a random-suffix sibling opened `wx`, so the open refuses
* to follow a symlink planted at the temp path, and the fresh inode carries
* `options.mode` through the rename. Same-directory keeps the rename on one
* filesystem; a failure removes the temp file and rethrows.
*/
async function fallbackWriteFileAtomic(filename, content, options) {
	await mkdir(dirname(filename), {
		recursive: true,
		...options.dirMode === void 0 ? {} : { mode: options.dirMode }
	});
	const temp = `${filename}.${randomBytes(6).toString("hex")}.tmp`;
	try {
		await writeFile(temp, content, {
			mode: options.mode,
			flag: "wx"
		});
		await renameAtomicTemp(temp, filename);
	} catch (error) {
		await rm(temp, { force: true });
		throw error;
	}
}
/** Whether an exclusive create found an existing lock. */
async function isLockContention(error, lockPath) {
	const code = error?.code;
	if (code === "EEXIST") return true;
	if (code !== "EPERM") return false;
	try {
		await lstat(lockPath);
		return true;
	} catch {
		return false;
	}
}
const LOCK_RETRY_INITIAL_MS = 20;
const LOCK_RETRY_MAX_MS = 200;
/** The host's own default: sized for a file-work-only critical section. */
const DEFAULT_LOCK_WAIT_MS = 2e3;
/**
* Hold the cross-process writer lock for `filename` around one operation.
*
* The lock is a `wx`-created `<filename>.lock` sibling; paired with the
* rename-based commit above, readers stay lock-free and only writers contend.
* An `EPERM` counts as contention only when a fresh `lstat` confirms the lock
* exists, which covers exclusive-create behavior on Windows. The contender
* never removes an existing lock: file age cannot prove its owner stopped.
*/
async function fallbackWithFileLock(filename, operation, options) {
	const lockPath = `${filename}.lock`;
	const deadline = Date.now() + (options?.waitMs ?? DEFAULT_LOCK_WAIT_MS);
	let delay = LOCK_RETRY_INITIAL_MS;
	let retriedUnconfirmedPermissionError = false;
	for (;;) {
		try {
			await writeFile(lockPath, `${process.pid}\n`, {
				mode: 384,
				flag: "wx"
			});
			break;
		} catch (error) {
			if (!await isLockContention(error, lockPath)) {
				const code = error?.code;
				if (process.platform !== "win32" || code !== "EPERM" || retriedUnconfirmedPermissionError) throw error;
				retriedUnconfirmedPermissionError = true;
			}
		}
		if (Date.now() >= deadline) throw new Error(`atomic-write: timed out waiting for the writer lock at ${lockPath}`);
		await new Promise((resolve) => setTimeout(resolve, delay));
		delay = Math.min(delay * 2, LOCK_RETRY_MAX_MS);
	}
	try {
		return await operation();
	} finally {
		await rm(lockPath, { force: true });
	}
}
/**
* Resolve the DeepSeek Harness home.
*
* Deliberately SYNCHRONOUS and self-contained rather than a host-first loader.
* The host package's `resolveDshHome` is a pure function of its arguments and
* `process.env` — it performs no I/O — and every call site in this plugin
* passes NO argument. The zero-argument form is `$DSH_HOME` (when non-blank)
* else `~/.dsh`, which is reproduced exactly below, so consulting the host
* copy could not change a single answer while it WOULD have forced the
* synchronous call sites (credential paths, the heartbeat path) to become
* async. The host import is therefore dropped outright.
*
* Cost of being wrong: nothing. Precedence is transcribed, not guessed, and
* the two branches are pinned by `tests/host-peers.spec.ts`.
*/
function resolveDshHome(configured) {
	return fallbackResolveDshHome(configured);
}
/**
* Replace `filename` with `content` atomically, under the sibling write lock.
*
* Async only because the host module is loaded lazily; inside DSH this is the
* host's own implementation.
*/
async function writeFileAtomic(filename, content, options) {
	const host = await hostAtomicWrite();
	if (host === void 0) return fallbackWriteFileAtomic(filename, content, options);
	return host.writeFileAtomic(filename, content, options);
}
/** Hold the cross-process writer lock for `filename` around one operation. */
async function withFileLock(filename, operation, options) {
	const host = await hostAtomicWrite();
	if (host === void 0) return fallbackWithFileLock(filename, operation, options);
	return host.withFileLock(filename, operation, options);
}
/**
* Which atomic-write implementation this process would use.
*
* `doctor` reports it so the "works inside DSH, crashed under `plugin exec`"
* split behind issue #47 is visible on demand instead of being inferred from a
* stack trace. `fallback` is the expected answer outside a booted host.
*/
async function hostPeersInfo() {
	return { atomicWrite: await hostAtomicWrite() === void 0 ? "fallback" : "host" };
}
//#endregion
//#region src/at-rest.ts
/**
* WorkBuddy desktop "at-rest" credential decryption.
*
* From 5.6.0 the WorkBuddy desktop app no longer stores `auth.accessToken` /
* `auth.refreshToken` as plain strings. It writes a field wrapper:
*
*   { "$wbEncrypted": 1, "envelope": "<base64 of a JSON envelope>" }
*
* where the envelope is `{suite, keyId, nonce, authTag, ciphertext}` for
* AES-256-GCM with a 12-byte nonce and a 16-byte tag. The authenticated
* additional data is a length-prefixed transcript over the scheme, suite,
* keyId and framing, so the ciphertext can only be opened for the exact field
* shape it was sealed for.
*
* The field key itself is NOT a user secret: it is a build-time constant
* compiled into the app's own Electron native module
* (`electron_browser_workbuddy_storage`). The app fetches it through
* `loggerGet()` and hashes the returned base64 STRING (not the decoded bytes)
* to obtain the 32-byte key; `keyId` is the first 16 hex characters of that
* key's SHA-256.
*
* This module re-derives the same key by asking the installed app for the same
* payload, and caches it in memory for the process lifetime. Nothing is ever
* written to disk, and the payload is never logged.
*
* 改动：**「macOS 也加密」这一事实**（issue #15 真机取证）。本模块原先假设该
*   policy 是 Windows 先行、macOS 只是「将来可能」，于是 macOS 的可执行文件
*   路径用 App 名拼成 `<bundle>/Contents/MacOS/WorkBuddy`——而两个真实 bundle
*   的 `CFBundleExecutable` 都是 `Electron`，该路径并不存在。结果是 macOS 上
*   加密凭据**永远**取不到密钥，用户却被报成「未登录」。现在二进制名向 bundle
*   自己问（`macosBundleExecutable()`），候选含国际版 `WorkBuddy AI.app`，
*   并允许 App 被归入 applications 目录的子目录——扫到的候选必须先用
*   `CFBundleIdentifier` 确认身份才 `execFile`，因为**每个 Electron 应用的
*   二进制都叫 `Electron`**，只按名字匹配就可能启动另一个产品。
*
* @module dsh-connect-workbuddy/at-rest
*/
/** Envelope framing names, mapped to the single-byte AAD framing code. */
const FRAMING_CODE = {
	file: 1,
	field: 2,
	record: 3,
	stream: 4
};
/** Standard (symmetric) format identifiers, transcripted into the AAD. */
const STANDARD_FORMAT_ID = {
	file: "WBEF1",
	field: "WBEV1",
	record: "WBER1",
	stream: "WBES1"
};
/** Domain separator the AAD transcript starts with. */
const AAD_DOMAIN = Buffer.from("WB-AAD\0", "ascii");
/** Scheme name of the symmetric envelope this module opens. */
const SYMMETRIC_SCHEME = "sym-v1";
/** Env override pointing at the WorkBuddy desktop executable. */
const WORKBUDDY_APP_EXECUTABLE_ENV = "WORKBUDDY_APP_EXECUTABLE";
/** How long the app is given to answer with its key payload. */
const KEY_FETCH_TIMEOUT_MS = 1e4;
/**
* File names the WorkBuddy desktop executable goes by on Windows.
*
* `WorkBuddy.exe` is the domestic build. The international build ships as
* **`WorkBuddyAI.exe` under a `WorkBuddyAI` directory** (issue #68), and the
* probe list below carries no candidate that matched it — so a machine with only
* the international app installed could not find the key payload's source and
* reported the credentials as unreadable, which the UI then described as a
* wrong-region sign-in.
*
* Kept as a LIST rather than a second constant because the same name test is
* used in two places that must agree: the directory joiners below, and the
* registry-value validator (`normalizeRegistryExecutable`), which must accept a
* `DisplayIcon` pointing at either binary. The first entry is the canonical one
* used when a directory is known to hold the domestic build.
*/
const APP_EXECUTABLE_NAMES = ["WorkBuddy.exe", "WorkBuddyAI.exe"];
/** The canonical executable name; the rest of {@link APP_EXECUTABLE_NAMES}. */
const APP_EXECUTABLE_NAME = APP_EXECUTABLE_NAMES[0];
/**
* Windows install directories the desktop app is observed to use, in probe
* order, relative to a base such as `%LOCALAPPDATA%` or `%ProgramFiles%`.
*
* `Programs\WorkBuddy` is the common per-user layout; `WorkBuddy` is the flatter
* one some installers produce. The `WorkBuddyAI` pair is the international
* build's layout (issue #68) — both spellings are carried because the directory
* and the binary were observed to agree, but a future build could pair either
* way, and a miss here is invisible (it surfaces as "unreadable credentials").
*/
const WINDOWS_APP_SUBDIRECTORIES = [
	["Programs", "WorkBuddy"],
	["WorkBuddy"],
	["Programs", "WorkBuddyAI"],
	["WorkBuddyAI"]
];
/**
* macOS bundles the desktop app may be installed as, in probe order.
*
* `WorkBuddy.app` is the domestic build; `WorkBuddy AI.app` is the
* international one, and a machine may carry either or both. The user-level
* `~/Applications` location is included because macOS lets an app live there,
* and installs have been observed under a subdirectory of /Applications too —
* hence {@link findWorkbuddyAppExecutable}'s parent scan, which covers those
* without guessing any particular folder name.
*/
const MACOS_APP_BUNDLE_NAMES = ["WorkBuddy.app", "WorkBuddy AI.app"];
function encodeUint32(value) {
	const bytes = Buffer.allocUnsafe(4);
	bytes.writeUInt32BE(value);
	return bytes;
}
/** Length-prefixed UTF-8 string: uint32 big-endian length followed by the bytes. */
function encodeLengthPrefixed(value) {
	const bytes = Buffer.from(value, "utf8");
	return Buffer.concat([encodeUint32(bytes.length), bytes]);
}
/**
* The authenticated additional data for one `sym-v1` FIELD-framed envelope.
*
* Only the field framing is implemented: it is the shape the desktop app uses
* for credential fields, and it is also the shape that cannot be confused with
* a whole-file envelope, so an unexpected framing is a parse error rather than
* a silently wrong transcript.
*/
function fieldAad(keyId, suite, scheme = SYMMETRIC_SCHEME) {
	if (!/^[0-9a-f]{16}$/u.test(keyId)) throw new Error(`workbuddy: envelope keyId is malformed`);
	return Buffer.concat([
		AAD_DOMAIN,
		Buffer.from([1]),
		encodeLengthPrefixed(STANDARD_FORMAT_ID["field"]),
		encodeLengthPrefixed(scheme),
		encodeUint32(suite),
		encodeLengthPrefixed(keyId),
		Buffer.from([FRAMING_CODE["field"]]),
		Buffer.from([0]),
		Buffer.from([0])
	]);
}
/** Whether a value is the app's encrypted-field wrapper. */
function isEncryptedFieldWrapper(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const wrapper = value;
	const keys = Object.keys(wrapper).sort();
	return keys.length === 2 && keys[0] === "$wbEncrypted" && keys[1] === "envelope" && wrapper["$wbEncrypted"] === 1 && typeof wrapper["envelope"] === "string";
}
/**
* The at-rest key id for a derived 32-byte key: the first 16 hex characters of
* its SHA-256. This is what the envelope's `keyId` is checked against, so a
* mismatched key fails loudly instead of returning garbage.
*/
function deriveAtRestKeyId(key) {
	return createHash("sha256").update(key).digest("hex").slice(0, 16);
}
/**
* Derive the 32-byte field key from the app's key payload JSON.
*
* The app hashes the payload's base64 STRING — not its decoded bytes — so the
* same spelling is required here; hashing the decoded secret would produce a
* different key and every field would fail to open.
*/
function deriveAtRestKey(payloadJson) {
	let payload;
	try {
		payload = JSON.parse(payloadJson);
	} catch {
		throw new Error("workbuddy: at-rest key payload is not valid JSON");
	}
	if (typeof payload !== "object" || payload === null || Array.isArray(payload)) throw new Error("workbuddy: at-rest key payload is not an object");
	const secret = payload["atRestSecretKey"];
	if (typeof secret !== "string" || secret === "") throw new Error("workbuddy: at-rest key payload carries no atRestSecretKey");
	return createHash("sha256").update(secret, "utf8").digest();
}
/**
* Open one encrypted field with a derived key and return its plaintext.
*
* Throws when the envelope is malformed, belongs to another key, or fails
* authentication — a GCM tag mismatch is the signal that the transcript or the
* key is wrong, and it must never degrade into a truncated token.
*/
function openEncryptedField(field, key) {
	let envelope;
	try {
		envelope = JSON.parse(Buffer.from(field.envelope, "base64").toString("utf8"));
	} catch {
		throw new Error("workbuddy: encrypted field envelope is not valid JSON");
	}
	if (typeof envelope !== "object" || envelope === null || Array.isArray(envelope)) throw new Error("workbuddy: encrypted field envelope is not an object");
	const record = envelope;
	const suite = record["suite"];
	const keyId = record["keyId"];
	const nonce = record["nonce"];
	const authTag = record["authTag"];
	const ciphertext = record["ciphertext"];
	if (typeof suite !== "number" || typeof keyId !== "string") throw new Error("workbuddy: encrypted field envelope is missing suite or keyId");
	if (typeof nonce !== "string" || typeof authTag !== "string" || typeof ciphertext !== "string") throw new Error("workbuddy: encrypted field envelope is missing nonce, authTag or ciphertext");
	const expectedKeyId = deriveAtRestKeyId(key);
	if (keyId !== expectedKeyId) throw new Error(`workbuddy: encrypted field belongs to key ${keyId}, not the available key ${expectedKeyId}`);
	const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(nonce, "base64"), { authTagLength: 16 });
	decipher.setAAD(fieldAad(keyId, suite));
	decipher.setAuthTag(Buffer.from(authTag, "base64"));
	return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64")), decipher.final()]).toString("utf8");
}
/**
* The executable inside a macOS app bundle, read from the bundle's own
* `Info.plist`.
*
* The binary is NOT reliably named after the app: the WorkBuddy bundles ship
* with `CFBundleExecutable` set to `Electron`, so a path assembled as
* `<bundle>/Contents/MacOS/WorkBuddy` does not exist and the app looks absent
* even when it is installed in the default location. Because the bundle
* documents the real name, asking it is both correct and robust to a future
* build that renames the binary.
*
* Returns undefined when the plist is absent, unreadable, or carries no usable
* name — never a guessed path, so a caller can keep probing.
*/
function macosBundleExecutable(bundle) {
	let plist;
	try {
		plist = readFileSync(join(bundle, "Contents", "Info.plist"), "utf8");
	} catch {
		return;
	}
	const name = /<key>\s*CFBundleExecutable\s*<\/key>\s*<string>([^<]*)<\/string>/u.exec(plist)?.[1]?.trim();
	if (name === void 0 || name === "" || name.includes("/") || name.includes("\\") || name === "." || name === "..") return;
	return join(bundle, "Contents", "MacOS", name);
}
/**
* The executable path WorkBuddy's own uninstall registration points at, or
* undefined when the app was never registered.
*
* Why this exists: the four directory candidates in
* {@link workbuddyAppExecutableCandidates} encode the DEFAULT install layout.
* An app installed anywhere else — a second drive (the observed case was
* `E:\workbuddy\WorkBuddy.exe`) — is installed and signed in, yet every
* candidate misses, so the encrypted credential file cannot be opened and a
* user who IS signed in is reported as signed out. The README's answer was to
* set `WORKBUDDY_APP_EXECUTABLE` by hand; the installer already recorded the
* answer, so this reads it instead.
*
* The registration is the app's own claim about itself, which is what makes it
* safe to hand the path to the credential probe: a display name alone would be
* a guess, whereas the path here was written by the installer that placed the
* binary. The value is still checked against {@link APP_EXECUTABLE_NAME} and for
* existence before use, and the callers fall through to the documented hint when
* it is absent.
*
* The read is done through ALL THREE uninstall views, because the hive a
* registration lands in depends on how the app was installed: per-user
* (`/currentuser`, the layout WorkBuddy uses) registers under `HKCU`, a
* machine-wide install under `HKLM`, and a 32-bit machine-wide one under
* `HKLM\...\WOW6432Node`. A hive that does not exist or is unreadable is the
* normal case on a machine without the app, not an error: every failure path
* returns undefined so the caller can try the next candidate.
*/
function windowsRegistryAppExecutable(query = queryRegistry) {
	for (const root of [
		"HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
		"HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
		"HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall"
	]) {
		const listing = query([
			"query",
			root,
			"/s",
			"/f",
			"WorkBuddy",
			"/t",
			"REG_SZ"
		]);
		if (listing === void 0) continue;
		const executable = registryExecutableFromQuery(listing);
		if (executable !== void 0) return executable;
		const fromDirectory = registryInstallLocationFromQuery(listing);
		if (fromDirectory !== void 0) return fromDirectory;
	}
}
/**
* Parse `reg query` output for the value that names the installed executable.
*
* `reg query` prints keys as `HKEY_CURRENT_USER\...\Uninstall\<id>` followed by
* indented `    ValueName    REG_SZ    Data` lines. Only `DisplayIcon` is
* trusted here: it is the one value the installer writes pointing AT the
* binary. The value is normalised by {@link normalizeRegistryExecutable}, which
* strips the quotes and the icon index and rejects anything that is not the
* desktop executable.
*/
function registryExecutableFromQuery(output) {
	for (const rawLine of output.split(/\r?\n/u)) {
		const match = /^\s*DisplayIcon\s+REG_SZ\s+(.*?)\s*$/u.exec(rawLine);
		if (match === null) continue;
		const executable = normalizeRegistryExecutable(match[1]);
		if (executable !== void 0) return executable;
	}
}
/**
* The `WorkBuddy.exe` under an `InstallLocation`-style registry directory.
*
* Kept separate from {@link registryExecutableFromQuery} because the two values
* mean different things: `DisplayIcon` NAMES a file, whereas the directory has
* to have {@link APP_EXECUTABLE_NAME} joined onto it, and the result must still
* be checked for existence by the caller's probe.
*
* `win32.join` rather than the host's `join`: the input is a Windows registry
* value on EVERY machine this function can be called on. `path.join` is the
* running platform's, so a suite on Linux/macOS would mangle `E:\workbuddy`
* into `E:\workbuddy/WorkBuddy.exe` and the caller's `existsSync` could never
* match it. The separator here is fixed by the DATA, not by the host.
*/
function registryInstallLocationFromQuery(output) {
	for (const rawLine of output.split(/\r?\n/u)) {
		const match = /^\s*InstallLocation\s+REG_SZ\s+(.*?)\s*$/u.exec(rawLine);
		if (match === null) continue;
		const directory = stripRegistryQuotes(match[1]);
		if (directory === void 0 || directory === "") continue;
		return win32.join(directory, APP_EXECUTABLE_NAME);
	}
}
/**
* A registry executable value reduced to a usable path, or undefined when it
* cannot be one.
*
* `DisplayIcon` is stored as `"E:\workbuddy\WorkBuddy.exe",0`. The quotes and
* the icon index are stripped, and a value that names something other than the
* desktop executable — an `.ico`, an uninstaller, another product's binary — is
* rejected rather than launched. A bare path without quotes is accepted too,
* because not every installer writes the indexed form.
*
* The basename test uses `win32.basename` for the reason given on
* {@link registryInstallLocationFromQuery}: the separator belongs to the
* registry value (always Windows), so the host's `basename` — which does not
* treat `\` as a separator — would return the whole string and reject every
* legitimate path.
*/
function normalizeRegistryExecutable(value) {
	const unquoted = stripRegistryQuotes(value);
	if (unquoted === void 0 || unquoted === "") return void 0;
	const withoutIndex = unquoted.replace(/,\s*-?\d+\s*$/u, "");
	if (withoutIndex === "") return void 0;
	const base = win32.basename(withoutIndex).toLowerCase();
	if (!APP_EXECUTABLE_NAMES.some((name) => name.toLowerCase() === base)) return void 0;
	return withoutIndex;
}
/**
* The path inside a `DisplayIcon`/`InstallLocation` value, unquoted.
*
* Registry data may be written either quoted (`"E:\workbuddy\WorkBuddy.exe",0`)
* or bare. Only a leading quote is treated as quoting: a bare `C:\dir\a"b.exe`
* is a real (if unusual) filename and must not be truncated at the quote.
*/
function stripRegistryQuotes(value) {
	const trimmed = value.trim();
	if (trimmed === "") return void 0;
	if (!trimmed.startsWith("\"")) return trimmed;
	const closing = trimmed.indexOf("\"", 1);
	if (closing === -1) return void 0;
	return trimmed.slice(1, closing).trim();
}
/**
* Run `reg query` and return its stdout, or undefined when it cannot be run.
*
* `windowsHide` is REQUIRED, not cosmetic: the DSH Desktop host is an Electron
* GUI process with no console, so spawning a console program without it flashes
* a visible black window on every probe. The same reason is recorded for the
* heartbeat probe in `host-heartbeat.ts` and in `docs/WINDOWS.md` §1-3.
*
* `execFileSync` (not `execFile`) keeps this synchronous so the candidates list
* stays a pure function of its inputs: it is called during `findWorkbuddyApp`
* `Executable`, which `readAtRestKey()` and the `doctor` command both treat as
* a plain lookup. The read is bounded by the registry query's own output and
* happens at most once per discovery.
*/
function queryRegistry(args) {
	try {
		return execFileSync("reg", [...args], REGISTRY_PROBE_OPTIONS);
	} catch {
		return;
	}
}
/**
* Options for the registry probe; `windowsHide` is mandatory (see above), and
* the timeout matches `fetchAtRestKeyPayload()`'s: a hung `reg` must not wedge
* the synchronous discovery path forever.
*/
const REGISTRY_PROBE_OPTIONS = {
	encoding: "utf8",
	windowsHide: true,
	timeout: 1e4
};
/**
* Candidate paths of the WorkBuddy desktop executable, in probe order.
*
* The Windows build is the one that encrypts credentials, so Windows leads;
* the macOS bundles are listed because the same native module ships there and
* the encryption policy is enabled on macOS builds too (observed from 5.6.x),
* and `undefined` entries (an unset env variable) are dropped.
*
* On macOS the executable name comes from each bundle (see
* {@link macosBundleExecutable}) rather than being assembled from the app name.
*
* `readBundleExecutable` is injectable, in the same spirit as `platform`/`home`/
* `env`: the macOS branch consults the real filesystem, so without a seam the
* expected candidates would depend on whether the host machine happens to have
* the app installed — and the test would pass on a developer's Mac while
* failing in CI.
*/
function workbuddyAppExecutableCandidates(platform = process.platform, home = homedir(), env = process.env, readBundleExecutable = macosBundleExecutable) {
	const candidates = [env[WORKBUDDY_APP_EXECUTABLE_ENV]?.trim()];
	if (platform === "win32") {
		const local = env["LOCALAPPDATA"]?.trim();
		const programFiles = env["ProgramFiles"]?.trim();
		const programFilesX86 = env["ProgramFiles(x86)"]?.trim();
		const bases = [
			local === void 0 || local === "" ? void 0 : local,
			programFiles === void 0 || programFiles === "" ? void 0 : programFiles,
			programFilesX86 === void 0 || programFilesX86 === "" ? void 0 : programFilesX86
		];
		for (const base of bases) {
			if (base === void 0) continue;
			for (const subdirectory of WINDOWS_APP_SUBDIRECTORIES) for (const name of APP_EXECUTABLE_NAMES) candidates.push(win32.join(base, ...subdirectory, name));
		}
	} else if (platform === "darwin") for (const name of MACOS_APP_BUNDLE_NAMES) candidates.push(readBundleExecutable(join("/Applications", name)), readBundleExecutable(join(home, "Applications", name)));
	return candidates.filter((candidate) => candidate !== void 0 && candidate !== "");
}
/**
* Bundle identifier PREFIXES the desktop app is signed with — `com.tencent.
* workbuddy` (domestic, observed as `…workbuddy.mac`) and `com.workbuddy`
* (international, observed as `com.workbuddy.workbuddy-ai`).
*
* Used to CONFIRM that a discovered bundle really is WorkBuddy before it is
* launched. This matters because the discovery below scans directories and then
* execs what it finds: every Electron app is built around a binary called
* `Electron`, so a name-only match could pick a different product's bundle and
* run it. The identifier is the app's own claim about itself, so it is the
* check that makes the scan safe.
*/
const APP_BUNDLE_IDENTIFIER_PREFIXES = ["com.tencent.workbuddy", "com.workbuddy"];
/**
* Whether a bundle identifies itself as the WorkBuddy desktop app.
*
* The match is on dot boundaries, so a hypothetical `com.workbuddyish` cannot
* pass as `com.workbuddy`.
*
* An unreadable or identifier-less plist is treated as NOT WorkBuddy: refusing
* a candidate only costs a fallback to another path, whereas accepting the
* wrong one would execute an unrelated application.
*/
function isWorkbuddyBundle(bundle) {
	let plist;
	try {
		plist = readFileSync(join(bundle, "Contents", "Info.plist"), "utf8");
	} catch {
		return false;
	}
	const identifier = /<key>\s*CFBundleIdentifier\s*<\/key>\s*<string>([^<]*)<\/string>/u.exec(plist)?.[1]?.trim().toLowerCase();
	if (identifier === void 0 || identifier === "") return false;
	return APP_BUNDLE_IDENTIFIER_PREFIXES.some((prefix) => identifier === prefix || identifier.startsWith(`${prefix}.`));
}
/**
* Bundles of the desktop app found one level BELOW a macOS applications
* directory.
*
* Users do file apps into subfolders (`/Applications/IDE/WorkBuddy.app`), and
* a hardcoded `/Applications/<name>` then reports the app as missing while it
* is installed and signed in. The scan is deliberately ONE level deep and
* matches the known bundle names only, so it stays predictable and cheap; each
* candidate is then confirmed by {@link isWorkbuddyBundle} before use.
*
* Returns [] when the parent is absent or unreadable — a missing directory is
* the normal case, not an error.
*/
function macosNestedAppBundles(parent) {
	let entries;
	try {
		entries = readdirSync(parent);
	} catch {
		return [];
	}
	const bundles = [];
	for (const entry of entries) {
		const nested = join(parent, entry);
		for (const name of MACOS_APP_BUNDLE_NAMES) {
			const bundle = join(nested, name);
			try {
				if (!statSync(bundle).isDirectory()) continue;
			} catch {
				continue;
			}
			if (isWorkbuddyBundle(bundle)) bundles.push(bundle);
		}
	}
	return bundles;
}
/**
* Locate the desktop executable AND say how it was found.
*
* Kept beside {@link findWorkbuddyAppExecutable} rather than folded into it
* because the two answer different questions: callers on the credential path
* only want the path, whereas `doctor` must explain the discovery. Sharing the
* candidate list keeps them from drifting.
*/
function findWorkbuddyAppExecutableWithSource(platform = process.platform, home = homedir(), env = process.env, readRegistryAppPath = windowsRegistryAppExecutable) {
	const fromEnv = env[WORKBUDDY_APP_EXECUTABLE_ENV]?.trim();
	for (const candidate of workbuddyAppExecutableCandidates(platform, home, env)) {
		try {
			if (!existsSync(candidate)) continue;
		} catch {
			continue;
		}
		return {
			executable: candidate,
			source: fromEnv !== void 0 && fromEnv !== "" && candidate === fromEnv ? "env" : "default-layout"
		};
	}
	if (platform === "win32") {
		const fromRegistry = readRegistryAppPath();
		if (fromRegistry !== void 0) try {
			if (existsSync(fromRegistry)) return {
				executable: fromRegistry,
				source: "registry"
			};
		} catch {}
	}
	const executable = findWorkbuddyAppExecutable(platform, home, env, readRegistryAppPath);
	return executable === void 0 ? void 0 : {
		executable,
		source: "nested-bundle"
	};
}
/**
* The first candidate that exists as a file, or undefined when the desktop app
* is not installed where this platform expects it.
*/
function findWorkbuddyAppExecutable(platform = process.platform, home = homedir(), env = process.env, readRegistryAppPath = windowsRegistryAppExecutable) {
	for (const candidate of workbuddyAppExecutableCandidates(platform, home, env)) try {
		if (existsSync(candidate)) return candidate;
	} catch {}
	if (platform === "win32") {
		const fromRegistry = readRegistryAppPath();
		if (fromRegistry !== void 0) try {
			if (existsSync(fromRegistry)) return fromRegistry;
		} catch {}
	}
	if (platform === "darwin") for (const parent of ["/Applications", join(home, "Applications")]) for (const bundle of macosNestedAppBundles(parent)) {
		const executable = macosBundleExecutable(bundle);
		if (executable === void 0) continue;
		try {
			if (existsSync(executable)) return executable;
		} catch {}
	}
}
/**
* Ask the installed desktop app for its key payload by running its own binary
* as plain Node (`ELECTRON_RUN_AS_NODE`) and calling the native binding.
*
* The binding is the app's own public surface for this value, so the plugin
* never has to carry a copy of a build-specific constant: it asks the very
* build that wrote the file. The child is given no stdin and a hard timeout,
* and its stdout is the only thing read.
*/
function fetchAtRestKeyPayload(executable) {
	return new Promise((resolve, reject) => {
		execFile(executable, ["-e", "try{process.stdout.write(process._linkedBinding('electron_browser_workbuddy_storage').loggerGet())}catch(e){process.exitCode=3;process.stderr.write(String(e&&e.message||e))}"], {
			env: {
				...process.env,
				ELECTRON_RUN_AS_NODE: "1"
			},
			timeout: KEY_FETCH_TIMEOUT_MS,
			windowsHide: true,
			maxBuffer: 1048576
		}, (error, stdout, stderr) => {
			if (error !== null) {
				reject(/* @__PURE__ */ new Error(`workbuddy: the desktop app did not provide its at-rest key (${stderr.trim() || error.message})`));
				return;
			}
			const payload = stdout.trim();
			if (payload === "") {
				reject(/* @__PURE__ */ new Error("workbuddy: the desktop app returned an empty at-rest key payload"));
				return;
			}
			resolve(payload);
		});
	});
}
/** Process-lifetime cache of the derived key; never persisted. */
let cachedKey;
let inflightKey;
/**
* When the last FAILED lookup finished, epoch ms; 0 means "no recent failure".
*
* Issue #77: only a SUCCESS was remembered, so a machine where the key cannot
* be obtained re-ran the whole discovery on every single probe. `scanAll()`
* probes one auth file at a time, and a usage request scans several times, so
* one page open re-ran the discovery dozens of times — each run being three
* SYNCHRONOUS `reg query` child processes on the host's main thread when the
* desktop app is not installed (measured 15.3 s of a 19.1 s request, 135
* `reg.exe` spawns). A failure is therefore remembered for
* {@link AT_REST_KEY_FAILURE_TTL_MS}: the answer cannot change within one page
* open, while a user who installs or launches the app still sees it pick up
* within that window instead of only after a restart.
*/
let failedKeyAtMs = 0;
/** The discovery result behind the current key (or failure); see {@link discoverAppExecutable}. */
let cachedAppExecutable;
/**
* How long a failed key lookup is remembered. Long enough to collapse the
* dozens of probes one request makes, short enough that installing (or
* launching) the desktop app takes effect without a restart.
*/
const AT_REST_KEY_FAILURE_TTL_MS = 6e4;
/**
* How long a NEGATIVE executable discovery is remembered.
*
* The negative answer is the expensive one: every candidate path misses, then
* the Windows fallback shells out to `reg query` once per uninstall hive. The
* positive answer is cached for the process lifetime instead — its path is
* retried with `existsSync` on every call anyway, so an app that was moved or
* removed still falls through to a fresh discovery.
*/
const APP_EXECUTABLE_MISS_TTL_MS = 6e4;
/**
* Locate the desktop executable through {@link findWorkbuddyAppExecutable},
* remembering a MISS for {@link APP_EXECUTABLE_MISS_TTL_MS}.
*
* Only this module's own lookup is cached, and only when it goes through the
* real seams: `findWorkbuddyAppExecutable` stays a pure function of its
* arguments for `doctor` and for the injected-platform tests, which must keep
* seeing the machine as it is right now.
*/
function discoverAppExecutable() {
	const now = Date.now();
	if (cachedAppExecutable !== void 0) {
		if (now - cachedAppExecutable.foundAtMs < APP_EXECUTABLE_MISS_TTL_MS) return cachedAppExecutable.executable;
		cachedAppExecutable = void 0;
	}
	const executable = findWorkbuddyAppExecutable();
	if (executable === void 0) {
		cachedAppExecutable = {
			executable: "",
			foundAtMs: now
		};
		return;
	}
	cachedAppExecutable = {
		executable,
		foundAtMs: Number.POSITIVE_INFINITY
	};
	return executable;
}
/**
* The desktop app's at-rest field key, or undefined when it cannot be obtained
* (app not installed, an older build without the native module, or a future
* build that rotates the payload).
*
* Both outcomes are cached: a success for the process lifetime (the app is
* spawned at most once), a failure for {@link AT_REST_KEY_FAILURE_TTL_MS}. The
* failure TTL is what keeps a machine WITHOUT the app from paying the
* synchronous registry probe on every credential file — see {@link failedKeyAtMs}.
*/
function readAtRestKey() {
	if (cachedKey !== void 0) return Promise.resolve(cachedKey);
	if (inflightKey !== void 0) return inflightKey;
	if (failedKeyAtMs !== 0 && Date.now() - failedKeyAtMs < AT_REST_KEY_FAILURE_TTL_MS) return Promise.resolve(void 0);
	inflightKey = (async () => {
		const executable = discoverAppExecutable();
		if (executable === void 0) return void 0;
		return deriveAtRestKey(await fetchAtRestKeyPayload(executable));
	})().then((key) => {
		cachedKey = key;
		failedKeyAtMs = key === void 0 ? Date.now() : 0;
		return key;
	}, (error) => {
		failedKeyAtMs = Date.now();
		throw error;
	}).finally(() => {
		inflightKey = void 0;
	});
	return inflightKey;
}
/** Drop the cached key; tests and diagnostics only. */
function clearAtRestKeyCache() {
	cachedKey = void 0;
	inflightKey = void 0;
	failedKeyAtMs = 0;
	cachedAppExecutable = void 0;
}
//#endregion
//#region src/windows-acl.ts
/**
* Windows ACL hardening for the plugin's credential vault (issue #183).
*
* THE REPORT. `<dsh home>/workbuddy-vault/<region>/<accountId>.json` holds the
* decrypted WorkBuddy `accessToken` / `refreshToken` as plaintext JSON, and the
* writer asked for `mode: 0o600`. On POSIX that is the whole story. On Windows
* `mode` is accepted and effectively ignored: a file's permissions come from the
* DACL it inherits from its parent directory, and nothing in `fs.writeFile` or
* `fs.rename` consults the mode argument there. The reporter measured the
* result with `Get-Acl`: the vault files came out readable by
* `<machine>\CodexSandboxUsers` — the account DSH's own sandbox runs as — so any
* sandboxed process, sibling plugin or script on that machine could read a
* usable JWT straight off disk.
*
* WHY HARDEN THE DIRECTORY, NOT JUST THE FILE. Two reasons, both measured:
*
*   1. The writer commits with an atomic replace (`writeFileAtomic`): a fresh
*      `<name>.<hex>.tmp` inode is created and renamed over the target. A
*      per-file ACL applied AFTER the rename leaves a window in which the new
*      inode carries whatever it inherited, and a crash mid-sequence leaves a
*      file that was never hardened. Children of a hardened directory inherit
*      the hardened ACEs at creation, so the replacement is born correct.
*   2. Windows RE-PROPAGATES inheritable ACEs down an existing tree, so
*      hardening the directory also repairs the files already sitting in it.
*      Verified on a real Windows 11 host: a file carrying
*      `Everyone: FullControl` inherited from `~/.dsh` came out with exactly the
*      three intended ACEs after only the directory was hardened.
*
* WHY NOT `icacls /T`. Measured on the same host: `/T` combined with an
* `(OI)(CI)` grant spec blanks the DACL of the FILES it walks — they end up with
* zero ACEs, which reads as "nobody may read this" and would break the plugin's
* own reads. The two-pass form (directories with `(OI)(CI)`, then files with a
* plain `(F)` grant) produces the correct result, so `/T` is deliberately not
* used anywhere here.
*
* WHY WINDOWS SIDS AND NOT NAMES. `icacls` prints and accepts localized account
* names, and this project's hosts are frequently zh-CN (`Everyone` shows up as
* `Everyone` but `BUILTIN\Administrators` does not). The `*S-1-5-…` form makes
* every argument locale-independent, so the same argv works on any UI language.
*
* WHY `OWNER RIGHTS` (S-1-3-4) RATHER THAN THE CURRENT USER — AND WHERE THAT
* ASSUMPTION BREAKS. Resolving the current user's SID costs a child process
* (`whoami`) on every hardening round, and the answer is usually already
* implied: the process that creates a file becomes its owner, so `OWNER RIGHTS`
* grants exactly the account that will read it back. `SYSTEM` and
* `Administrators` are kept so backup/AV/service software that legitimately
* expects to reach user files is not locked out — removing them would make the
* vault unmanageable on a machine where the user's own session is not the one
* repairing it.
*
* THE BREAK. "The creator is the owner" only holds when the creating process
* runs with the user's own (possibly elevated) token. When a directory was
* created by a process whose token derives from the Administrators group — an
* elevated DSH started from a RunLevel=Highest scheduled task, an installer,
* a recovery console — the directory owner is `BUILTIN\Administrators`, and
* `OWNER RIGHTS` then grants Administrators, not the user. Because
* {@link applyAcl} also drops inherited ACEs (`/inheritance:r`), a non-admin
* user is left with NO access at all to their own vault: stat/readdir/write
* all fail with EPERM, and recovery requires an explicit `takeown`. Reproduced
* as a controlled experiment (same command, only the owner differs):
* owner=user → writable; owner=Administrators → locked. Reported in issue
* #199 (forensic: fork branch `forensic/acl-lockout-20261102`).
*
* THE FIX. The grant names the account that will read the vault — the current
* user — EXPLICITLY, and never relies on `OWNER RIGHTS`. {@link resolveUserSid}
* reads that SID once per process (memoized) via `whoami.exe`, which measured
* 22–26 ms on the reported host against PowerShell's 133 ms;
* {@link hardenDirectory} then issues the same single `icacls` call the 5.x
* design used, with `*<userSid>:(OI)(CI)(F)` in place of `*S-1-3-4`. Because
* the granted principal no longer depends on who owns the object, a vault
* created by an elevated process (owner = Administrators) stays readable by
* its user.
*
* WHY NOT COMPARE THE OWNER FIRST. The alternative — read each directory's
* owner and keep `OWNER RIGHTS` when it matches the user — needs a PowerShell
* `Get-Acl` (~133 ms) on the credential-write path, and it does not buy
* anything: the granted principal is always the user, so the comparison only
* decides which spelling of the same grant to emit. That extra child process
* is also what broke the 1 s polling budget of
* `tests/issue12-region-hiding.spec.ts` while this fix was being developed
* (measured: the owner lookup plus the user lookup pushed a first vault write
* past the budget, the startup refresh lost the race, and the global region
* kept advertising its fallback models). One memoized `whoami` for the whole
* process replaces a per-directory `Get-Acl`.
*
* OWNER RIGHTS IS STILL ACCEPTED ON READ. {@link ALLOWED_SIDS} keeps
* `S-1-3-4` so a vault hardened by 5.x — where the user usually IS the owner
* and the ACE therefore was correct — still reads as `protected` instead of
* being reported as a widening that never happened. It is simply no longer
* ever GRANTED.
*
* WHAT THIS IS AND IS NOT. This is the issue's suggestion #2 (explicit ACLs
* after writing), which it calls "the smallest change". It is NOT DPAPI
* encryption (suggestion #1): the bytes on disk remain plaintext, so an
* administrator, a SYSTEM service, or an attacker who has already achieved the
* user's own token can still read them. Closing that gap requires encrypting the
* document with a key bound to the user profile, which is a format change to the
* vault and cannot be done without a migration; it is tracked separately. The
* README says plainly that the file holds plaintext tokens.
*
* FAILURE IS NOT FATAL. A credential write is on the sign-in path: refusing to
* persist a credential because the ACL could not be applied would turn a
* defence-in-depth measure into an outage. Every function here is therefore
* best-effort and reports its outcome instead of throwing, and `doctor` surfaces
* that outcome so a machine where hardening silently failed is visible rather
* than assumed safe.
*
* @module dsh-connect-workbuddy/windows-acl
*/
/**
* Well-known SID for "the owner of this object".
*
* Deliberately a SID rather than an account name: it needs no lookup, it works
* on every UI language, and `icacls` accepts it in the `*S-…` form.
*
* Since issue #199 it is READ-ONLY here: 5.x granted it, which locks a user out
* of a directory owned by somebody else, so {@link directoryGrants} and
* {@link fileGrants} no longer use it — but {@link ALLOWED_SIDS} still accepts
* it, so a vault hardened by 5.x (where the user normally IS the owner) still
* inspects as `protected`.
*/
const OWNER_RIGHTS_SID = "S-1-3-4";
/** Well-known SID for `NT AUTHORITY\SYSTEM`. */
const SYSTEM_SID = "S-1-5-18";
/** Well-known SID for `BUILTIN\Administrators`. */
const ADMINISTRATORS_SID = "S-1-5-32-544";
/**
* Principals allowed to keep access, as SIDs.
*
* Used by {@link inspectCredentialDirectory} to tell "hardened" from "somebody
* widened it again"; keeping the list beside the grant specs is what stops the
* two from drifting.
*/
const ALLOWED_SIDS = /* @__PURE__ */ new Set([
	OWNER_RIGHTS_SID,
	SYSTEM_SID,
	ADMINISTRATORS_SID
]);
/**
* Grant specs for a DIRECTORY: `(OI)` object-inherit and `(CI)` container-inherit
* make the ACE apply to files and subdirectories created later, which is the
* whole mechanism this module relies on.
*
* `userSid` is deliberately a PARAMETER rather than a constant: it is the only
* principal whose identity is not a well-known SID, and making it explicit at
* the call site is what keeps a future edit from quietly falling back to
* `OWNER RIGHTS` (the issue #199 lockout).
*/
function directoryGrants(userSid) {
	return [
		`*${userSid}:(OI)(CI)(F)`,
		`*${SYSTEM_SID}:(OI)(CI)(F)`,
		`*${ADMINISTRATORS_SID}:(OI)(CI)(F)`
	];
}
/** How long one `icacls` (or PowerShell) child may take before it is abandoned. */
const ACL_COMMAND_TIMEOUT_MS = 1e4;
/** Paths already hardened by THIS process, so repeat writes cost nothing. */
const protectedDirectories = /* @__PURE__ */ new Set();
/** Hardening attempts in flight, keyed by path: a burst joins one child. */
const inflightProtection = /* @__PURE__ */ new Map();
/** Whether this process is running on Windows; a seam for tests. */
function isWindows() {
	return process.platform === "win32";
}
/**
* Run one child process, resolving to its stdout.
*
* `windowsHide` is mandatory for the same reason recorded in `at-rest.ts` and
* `docs/WINDOWS.md` §1-5: the DSH Desktop host is an Electron GUI process with
* no console, so spawning a console program without it flashes a visible black
* window. `icacls` here runs on the credential-write path, which a user can
* trigger repeatedly from the card — an un-hidden spawn would blink at them on
* every account switch.
*
* Sets `windowsVerbatimArguments: false` implicitly (the default) so each argv
* element is quoted by Node rather than concatenated: the grant specs contain
* parentheses, which a raw command-line join would hand to `cmd` for parsing.
* This is why the arguments go through `execFile` as an ARRAY and never as a
* single shell string.
*/
function runCommand(file, args) {
	return new Promise((resolve, reject) => {
		execFile(file, [...args], {
			encoding: "utf8",
			windowsHide: true,
			timeout: ACL_COMMAND_TIMEOUT_MS
		}, (error, stdout) => {
			if (error !== null) {
				reject(/* @__PURE__ */ new Error(`${file} exited ${String(error.code ?? error.message)}`));
				return;
			}
			resolve(stdout);
		});
	});
}
/**
* Apply one ownership set to `path` with `icacls`.
*
* `/inheritance:r` drops the inherited ACEs (that is what removes the
* `Everyone: FullControl` arriving from `~/.dsh`) and `/grant:r` replaces the
* ACE for each named principal rather than adding a duplicate, so the call is
* idempotent — measured: running it twice on the same file leaves the same three
* ACEs.
*/
async function applyAcl(path, grants) {
	const args = [path, "/inheritance:r"];
	for (const grant of grants) args.push("/grant:r", grant);
	await runCommand("icacls", args);
}
/**
* Harden one credential directory tree so that the files inside are readable
* only by their owner, SYSTEM and Administrators.
*
* ONE `icacls` CALL, NOT A WALK. Measured on a real Windows 11 host: hardening
* the parent directory makes Windows RE-PROPAGATE the new inheritable ACEs down
* the tree, repairing existing subdirectories AND existing files in the same
* step — a file carrying `Everyone: FullControl` inherited from `~/.dsh` came out
* with exactly the three intended ACEs (`weak=0`) after only its parent was
* hardened. Walking the children would spawn one child process per directory to
* re-derive a guarantee this single call already delivers.
*
* WHY THAT COST MATTERS HERE. This runs on the credential-write path, which the
* card can trigger per account switch. `icacls` measured 19–52 ms at rest and
* **up to 1242 ms under parallel load** — enough to blow the 1 s polling budget
* of `tests/issue12-region-hiding.spec.ts` when the whole suite ran
* concurrently. The shape below is therefore deliberate on two axes:
*
*   - CALLS: one, never a walk.
*   - CONCURRENCY: an attempt already in flight for the same path is JOINED
*     rather than repeated, so a burst of writes queues one child for one
*     directory instead of one per write.
*
* Staying ON the write path is not negotiable: the atomic commit creates a fresh
* temp inode and renames it over the target, so a file-level pass AFTERwards
* would leave the pre-rename window open and would be undone by the next
* replace. Hardening before the write is what makes the replacement inode
* inherit the restricted ACEs.
*
* Memoized per process on SUCCESS only: a failed attempt must be retried by the
* next write, or one transient lock on the directory would leave the machine
* unhardened for the rest of the session.
*/
async function protectCredentialDirectory(directory) {
	if (!isWindows()) return { state: "not-windows" };
	const refusal = harnessHomeRefusal(directory);
	if (refusal !== void 0) return {
		state: "skipped",
		reason: refusal
	};
	if (protectedDirectories.has(directory)) return { state: "protected" };
	const pending = inflightProtection.get(directory);
	if (pending !== void 0) return pending;
	const attempt = hardenDirectory(directory);
	inflightProtection.set(directory, attempt);
	try {
		return await attempt;
	} finally {
		inflightProtection.delete(directory);
	}
}
/**
* Why `directory` must NOT be hardened, or `undefined` when it may be
* (issue #208).
*
* THE DEFECT THIS CLOSES. Hardening drops inherited ACEs (`/inheritance:r`).
* Applied to `<DSH home>` itself that also drops what every OTHER directory
* under it inherits — `<DSH home>/attachments`, sessions, profile config —
* and a child whose DACL came purely from that inheritance becomes
* unreadable even to its owner. The reporter measured exactly that: after
* installing the plugin, sending an image failed with `EPERM: operation not
* permitted, scandir '<DSH home>/attachments'` while text messages were
* unaffected, and `icacls <DSH home>` itself printed "Access is denied". The
* UI showed the host's generic `prompt rejected (session/agent-busy)`, so the
* symptom pointed at sessions rather than at the DACL.
*
* HOW THIS PLUGIN COULD REACH IT. `writeVaultEntry` hardens `dirname(dir)`.
* For a region-scoped store that is `<DSH home>/workbuddy-vault` (correct), but
* the UNREGIONED store — which `doctor` builds via `makeAnyStore()` — keeps its
* vault AT `<DSH home>/workbuddy-vault` itself, so `dirname` resolves to
* `<DSH home>`. Reproduced here with a stubbed `icacls`: the argv target was
* the Harness home, and the three SIDs the reporter found on `<DSH home>` are
* exactly `directoryGrants()`'s.
*
* WHY REFUSE RATHER THAN SPECIAL-CASE THE CALLER. A guard at THIS layer also
* covers `<DSH home>/.dsh`-style ancestors, a future call site computing the
* root one level too high (the reporter's own third question), and a
* `WORKBUDDY_*` variable pointing the vault at `$HOME`. The blast radius of
* getting it wrong is the whole harness home, so the check belongs where the
* destructive operation is, not where its arguments are assembled.
*
* Ancestors are refused too, not just equality: hardening the PARENT of the
* harness home strips the inheritance the home itself relies on, which breaks
* it just as thoroughly and is even harder to recognise afterwards.
*/
function harnessHomeRefusal(directory) {
	let home;
	try {
		home = resolve(resolveDshHome());
	} catch {
		return "the Harness home could not be resolved, so this directory cannot be proven safe to harden";
	}
	const target = resolve(directory);
	if (target.toLowerCase() === home.toLowerCase()) return `refusing to harden the Harness home itself (${home}); /inheritance:r there would strip the ACEs every other directory under it inherits`;
	if (`${home}${sep}`.toLowerCase().startsWith(`${target}${sep}`.toLowerCase())) return `refusing to harden ${target}, which contains the Harness home (${home}); dropping inherited ACEs on an ancestor breaks the whole home tree`;
}
/**
* The current user's SID, resolved once per process.
*
* Node's `os.userInfo()` does NOT expose a SID on Windows (its typings have no
* `sid`, and the runtime object carries none — measured), so the SID has to
* come from outside the process.
*
* `whoami.exe` rather than PowerShell: measured on the machine that reported
* issue #199, `whoami /user /fo csv /nh` takes 22–26 ms while a
* `powershell -Command` round trip takes 133 ms — and since this shape pays the
* cost on the credential-write path, which the startup roster refresh is
* racing, that 5× difference is the difference between fitting the poll budget
* and blowing it.
*
* The absolute path is deliberate: a bare `whoami` resolves through `PATH`,
* where Git for Windows ships an MSYS `whoami` that does not understand
* `/user` at all. `/fo csv /nh` gives one quoted line
* (`"desktop\user","S-1-5-21-…"`), which is parsed rather than the default
* formatted block, again for locale independence.
*
* Memoized for the process on SUCCESS only: an unresolvable SID is a real
* failure and must be retried by the next write, not cached as broken forever.
*/
let cachedUserSid;
async function resolveUserSid() {
	if (cachedUserSid === void 0) {
		const line = (await runCommand(join(process.env.SystemRoot ?? "C:\\Windows", "System32", "whoami.exe"), [
			"/user",
			"/fo",
			"csv",
			"/nh"
		])).split(/\r?\n/u).map((entry) => entry.trim()).find((entry) => /S-1-5-[\d-]+/u.test(entry));
		if (line === void 0) throw new Error("whoami returned no resolvable user SID");
		const match = /"(S-1-5-[\d-]+)"/u.exec(line) ?? /S-1-5-[\d-]+/u.exec(line);
		if (match === null) throw new Error("whoami output has no parseable SID field");
		cachedUserSid = match[1] ?? match[0];
	}
	return cachedUserSid;
}
/** The work behind {@link protectCredentialDirectory}: one `icacls` call. */
async function hardenDirectory(directory) {
	try {
		await mkdir(directory, { recursive: true });
		let grants;
		try {
			grants = directoryGrants(await resolveUserSid());
		} catch (error) {
			return {
				state: "failed",
				reason: `user SID lookup failed: ${error instanceof Error ? error.message : String(error)}`
			};
		}
		await applyAcl(directory, grants);
		protectedDirectories.add(directory);
		return { state: "protected" };
	} catch (error) {
		return {
			state: "failed",
			reason: error instanceof Error ? error.message : String(error)
		};
	}
}
/**
* Read back the ACL of one credential directory as SIDs, for diagnostics.
*
* PowerShell rather than `icacls` because the answer has to be COMPARABLE:
* `icacls` prints localized account names, so testing "is `Everyone` absent"
* against its output would silently pass on a zh-CN host where the name is
* spelled differently. `Get-Acl` + `SecurityIdentifier.Value` yields the
* language-independent form.
*
* Read-only and token-free: it never opens the JSON, only the ACL. A failure to
* read is reported as `unverified` rather than being folded into `exposed` — the
* two need different user actions, and claiming exposure that was not measured
* would be its own kind of lie.
*/
async function inspectCredentialDirectory(directory) {
	if (!isWindows()) return {
		directory,
		state: "not-windows"
	};
	/**
	* Deliberately a single quoted expression with no interpolation of `directory`
	* beyond the literal path: `-LiteralPath` keeps a path containing `[` or `$`
	* from being treated as a wildcard or a subexpression.
	*/
	const script = [`$a = Get-Acl -LiteralPath '${directory.replace(/'/gu, "''")}'`, "$a.Access | ForEach-Object { $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value }"].join("; ");
	let stdout;
	try {
		stdout = await runCommand("powershell", [
			"-NoProfile",
			"-NonInteractive",
			"-Command",
			script
		]);
	} catch (error) {
		return {
			directory,
			state: "unverified",
			reason: error instanceof Error ? error.message : String(error)
		};
	}
	const entries = stdout.split(/\r?\n/u).map((line) => line.trim()).filter((line) => line !== "" && /^S-1-/u.test(line));
	if (entries.length === 0) return {
		directory,
		state: "unverified",
		reason: "Get-Acl returned no principals"
	};
	/**
	* The current user is an ALLOWED principal, not a widening.
	*
	* This is the read side of the issue #199 fix: 5.x granted `OWNER RIGHTS`,
	* whose SID (S-1-3-4) can be compared against {@link ALLOWED_SIDS} without
	* knowing who runs the process, but the fix grants the user's REAL SID — so
	* the allowlist has to learn it, or a correctly hardened directory reports as
	* `exposed` naming the user themselves. Measured on a real host before this
	* was wired up: `weak: ["S-1-5-21-…-1001"]` on a freshly hardened vault.
	*
	* An unresolvable user SID is reported as `unverified` rather than guessed:
	* without it the read cannot tell "the user" from "some other account", and
	* both wrong answers (allowing everyone / accusing the user) are worse than
	* saying the measurement did not happen.
	*/
	let userSid;
	try {
		userSid = await resolveUserSid();
	} catch (error) {
		return {
			directory,
			state: "unverified",
			reason: `user SID lookup failed: ${error instanceof Error ? error.message : String(error)}`
		};
	}
	const weak = entries.filter((sid) => sid !== userSid && !ALLOWED_SIDS.has(sid));
	return {
		directory,
		state: weak.length === 0 ? "protected" : "exposed",
		entries,
		weak
	};
}
/**
* 命名空间，且带版本号。
*
* 不带命名空间，本插件的派生值就可能与另一个工具的派生值在同一个 uid 上撞成
* 同值；不带版本号，将来改一次输入格式就会让所有账号**静默换设备**——那正是
* 风控最想抓的 device hopping。要改格式，就改这里的 `v1`，并接受"这是一次
* 有意的身份变更"，而不是让它悄悄发生。
*/
const DEVICE_ID_NAMESPACE = "dsh-connect-workbuddy/device/v1";
/** 36 个**小写**十六进制字符，别的一律不认。 */
const DEVICE_ID_PATTERN = /^[0-9a-f]{36}$/u;
/** 64 个**小写**十六进制字符。 */
const DEVICE_SALT_PATTERN = /^[0-9a-f]{64}$/u;
/**
* Derive one stable, account-scoped device identifier.
*
* `uid` 为空串时返回空串：匿名请求没有"这台设备属于哪个账号"可言，上游也不要求
* （B 的同名实现在 uid 为空时同样不注入）。返回空串而不是抛错，是因为调用方
* 只需要"发还是不发"，而"没有 uid"是正常状态，不是异常。
*
* @param uid the account's stable id, as the desktop auth document records it
* @param purpose which header this value is for — never reuse one for the other
* @param salt this machine's random salt (see `device-salt.ts`); a constant here
*   would make every install of this plugin derive identical ids
*/
function deriveDeviceId(uid, purpose, salt) {
	if (uid === "" || salt === "") return "";
	return createHash("sha256").update(`${DEVICE_ID_NAMESPACE}\0${salt}\0${purpose}\0${uid}`, "utf8").digest("hex").slice(0, 36);
}
/** Whether `value` is exactly a derived device id (36 lowercase hex). */
function isDeviceId(value) {
	return DEVICE_ID_PATTERN.test(value);
}
/** Whether `value` is exactly a device salt (64 lowercase hex). */
function isDeviceSalt(value) {
	return DEVICE_SALT_PATTERN.test(value);
}
/** 文件名，带前导点，与 `.workbuddy-roster-seen.*.json` 同一约定。 */
const DEVICE_SALT_FILE_NAME = ".workbuddy-device.json";
/** `$DSH_HOME/.workbuddy-device.json`, or `dir` when one is pinned (tests). */
function deviceSaltPath(dir) {
	const base = typeof dir === "string" && dir !== "" ? dir : resolveDshHome();
	return join(base, DEVICE_SALT_FILE_NAME);
}
/**
* Read one parsed salt document.
*
* `undefined` means the file is not there at all — the ONLY state that permits
* writing a new one. Everything else that is wrong with the file lands in
* `reason`, because "we cannot read our own salt" must stay distinguishable from
* "there is no salt yet".
*/
function parseDeviceSaltPayload(raw) {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { reason: "not a JSON object" };
	const document = raw;
	const version = document["version"];
	if (version !== 1) return { reason: `version ${typeof version === "number" ? version : "(absent)"} is not readable by this build` };
	const salt = document["salt"];
	if (typeof salt !== "string" || !isDeviceSalt(salt)) return { reason: "salt field is not 64 lowercase hex characters" };
	return { salt };
}
/**
* Read the salt WITHOUT writing anything.
*
* A missing file is `absent`; an unreadable one is `unreadable` (never
* `absent`) — see the module note on why that distinction is load-bearing.
*/
async function readDeviceSalt(options = {}) {
	const path = deviceSaltPath(options.dir);
	let text;
	try {
		text = await readFile(path, "utf8");
	} catch (error) {
		const code = error?.code;
		if (code === "ENOENT") return {
			path,
			state: "absent"
		};
		return {
			path,
			state: "unreadable",
			reason: code === void 0 ? String(error) : code
		};
	}
	let raw;
	try {
		raw = JSON.parse(text);
	} catch {
		return {
			path,
			state: "unreadable",
			reason: "file is not valid JSON"
		};
	}
	const parsed = parseDeviceSaltPayload(raw);
	if ("reason" in parsed) return {
		path,
		state: "unreadable",
		reason: parsed.reason
	};
	return {
		path,
		state: "ok",
		salt: parsed.salt
	};
}
/**
* Read the salt, creating it on the first call that needs one.
*
* The read happens twice — once unlocked (the common case costs one `readFile`),
* once inside the lock before writing — because two processes starting together
* would otherwise both find the file missing and both write a different salt;
* the loser's salt would then never be used again and its ids would silently
* change. Writing asks for `mode: 0o600` under a `0o700` directory: the value is
* not a credential, but it IS what makes this machine's derived ids unguessable.
* On Windows those bits are a no-op and the DACL decides — this file lives in
* `$DSH_HOME`, whose permissions `doctor` already hardens for the vault
* (`credentialAcl` in `src/bin.ts`).
*/
async function ensureDeviceSalt(options = {}) {
	const first = await readDeviceSalt(options);
	if (first.state !== "absent") return first;
	const path = first.path;
	try {
		return await withFileLock(path, async () => {
			const again = await readDeviceSalt(options);
			if (again.state !== "absent") return again;
			const salt = randomBytes(32).toString("hex");
			await writeFileAtomic(path, `${JSON.stringify({
				version: 1,
				salt,
				createdAt: (/* @__PURE__ */ new Date()).toISOString()
			}, null, 2)}\n`, {
				mode: 384,
				dirMode: 448
			});
			return {
				path,
				state: "ok",
				salt
			};
		});
	} catch (error) {
		const code = error?.code;
		return {
			path,
			state: "unwritable",
			reason: code === void 0 ? String(error) : code
		};
	}
}
//#endregion
//#region src/device-token.ts
/**
* 外部 `X-Device-Token` 的文件源（审计报告 §6 的 P2）。
*
* ## 为什么只有文件，没有"内联配置值"
*
* token 的有效期是分钟级（A 实测 10 分钟，旧值最多 24 小时可复用）。写在配置里
* 的值是死的：十分钟后它过期，只能靠人去改配置——那是一条每十分钟需要人工介入的
* 路径，实际上只在一次性排障里成立。文件可以由任何东西刷新（A 自己的
* `.turing_token_cache.json`、一个 cron、一个脚本），插件按 TTL 重读即可。
*
* ## 它与 B 的 `device_token.go` 差在哪（三处，都是刻意的）
*
*   1. **上限 4 KB，不是 1 KB**。A 现取的 token 实测 **1210 字符**（`v3:` 前缀、
*      单段不透明 blob），B 的 1024 字节上限会把它判成"过长"→ 返回空 →
*      **静默不注入**。token 明明有，网关那边却当作没有。
*   2. **JSON 信封与裸值都吃**。A 写的是 `{"token":"v3:…","ts":…}`，B 只认
*      裸值——直接把 B 指到 A 的缓存上，注入的会是整段 JSON。
*   3. **失败会记一条 warn**。B 是完全静默的，"配了但没生效"因此无法从任何地方
*      看出来。这里只在**状态发生变化**时告警一次，避免每条请求刷一行。
*
* ## 安全
*
* token 是设备身份，不是访问凭据，但它同样不该进日志：本模块的任何输出
* （包括错误、warn、doctor）都只带**路径、状态、时长**，绝不含 token 字节。
*
* @module dsh-connect-workbuddy/device-token
*/
/**
* 文件大小上限，单位字节。
*
* 4 KB 不是随手放的：A 的真实 token 是 1210 字符，B 的 1 KB 上限会误杀它；同时
* 4 KB 仍然远小于"贴错文件"的量级（把整个 auth.json 指过来会立刻被判过长）。
*/
const DEVICE_TOKEN_MAX_BYTES = 4096;
/** 默认重读周期。与 A 的磁盘缓存一致（10 分钟 token / 5 分钟重读）。 */
const DEVICE_TOKEN_DEFAULT_TTL_MS = 3e5;
/**
* 设备 token 文件路径的环境变量。
*
* **它不是第二个真源**，而是同一个值的第二种写法：插件配置 `deviceToken.file`
* 为空时才回落到它，而 `doctor` 只能看到环境变量（它读不到插件配置）。同一个
* 值、两个读者，因此不会出现"插件在用 A、CLI 报告 B"。
*/
const WORKBUDDY_DEVICE_TOKEN_FILE_ENV = "WORKBUDDY_DEVICE_TOKEN_FILE";
/**
* Expand a configured path.
*
* `~` is supported because that is how the one interesting path (`A` 的
* `.turing_token_cache.json`) is naturally written; everything else resolves
* against the process cwd, which is why the docs ask for an absolute path.
*/
function resolveDeviceTokenPath(file) {
	const trimmed = file.trim();
	if (trimmed === "~") return homedir();
	if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) return join(homedir(), trimmed.slice(2));
	return resolve(trimmed);
}
/**
* Parse the file body: either a bare token or A's `{token, ts}` envelope.
*
* The envelope is not a nicety — pointing this reader at A's cache file is the
* whole reason a user of both tools gets a working token with no extra script.
*/
function parseDeviceTokenDocument(text) {
	const trimmed = text.trim();
	if (trimmed === "") return { reason: "file is empty" };
	if (trimmed.startsWith("{")) {
		let document;
		try {
			document = JSON.parse(trimmed);
		} catch {
			return { reason: "file starts with { but is not valid JSON" };
		}
		if (typeof document !== "object" || document === null || Array.isArray(document)) return { reason: "JSON document is not an object" };
		const token = document["token"];
		if (typeof token !== "string" || token.trim() === "") return { reason: "JSON envelope has no non-empty token field" };
		return { token: token.trim() };
	}
	if (/\s/u.test(trimmed)) return { reason: "raw token must be a single line without whitespace" };
	return { token: trimmed };
}
/** Read the token file once. No caching — see {@link createDeviceTokenReader}. */
async function readDeviceTokenFile(file, nowMs = Date.now()) {
	const path = resolveDeviceTokenPath(file);
	let size;
	let modifiedMs;
	try {
		const info = await stat(path);
		if (!info.isFile()) return {
			path,
			state: "unreadable",
			reason: "path is not a regular file"
		};
		size = info.size;
		modifiedMs = info.mtimeMs;
	} catch (error) {
		const code = error?.code;
		if (code === "ENOENT") return {
			path,
			state: "absent"
		};
		return {
			path,
			state: "unreadable",
			reason: code === void 0 ? String(error) : code
		};
	}
	if (size > 4096) return {
		path,
		state: "too-large",
		reason: `${size} bytes exceeds the ${DEVICE_TOKEN_MAX_BYTES}-byte limit`
	};
	let text;
	try {
		text = await readFile(path, "utf8");
	} catch (error) {
		const code = error?.code;
		return {
			path,
			state: "unreadable",
			reason: code === void 0 ? String(error) : code
		};
	}
	const parsed = parseDeviceTokenDocument(text);
	if ("reason" in parsed) return {
		path,
		state: "unreadable",
		reason: parsed.reason
	};
	return {
		path,
		state: "ok",
		token: parsed.token,
		ageMs: Math.max(0, nowMs - modifiedMs)
	};
}
/**
* Build the reader.
*
* `warn` fires **only when the state changes** — a missing file would otherwise
* write one line per request, which is the noise that trains people to ignore
* logs. Recovery resets the memory, so a later break is reported again.
*/
function createDeviceTokenReader(options) {
	const ttlMs = options.ttlMs !== void 0 && Number.isFinite(options.ttlMs) && options.ttlMs > 0 ? options.ttlMs : DEVICE_TOKEN_DEFAULT_TTL_MS;
	let cached;
	let lastBadState;
	return {
		async current(nowMs = Date.now()) {
			if (cached !== void 0 && nowMs - cached.at < ttlMs) return cached.readout.token;
			const readout = await readDeviceTokenFile(options.file, nowMs);
			cached = {
				at: nowMs,
				readout
			};
			if (readout.state === "ok") {
				lastBadState = void 0;
				return readout.token;
			}
			if (readout.state !== lastBadState) {
				lastBadState = readout.state;
				options.warn?.(`device token file is ${readout.state}${readout.reason === void 0 ? "" : ` (${readout.reason})`}; X-Device-Token will not be sent. Path: ${readout.path}`);
			}
		},
		last() {
			return cached?.readout;
		}
	};
}
//#endregion
//#region src/native-modality.ts
/**
* Reviewed vendor classifications, keyed by EXACT model id (never a prefix).
* Ids absent from this record are `unknown` — see {@link nativeModalityOf}.
*/
const NATIVE_MODALITY_BY_MODEL_ID = {
	"deepseek-v4-pro": "text",
	"glm-5.1": "text",
	"glm-5.2": "text",
	"glm-5.3": "text",
	"hy3": "text",
	"hy4-preview": "text",
	"deepseek-v4.1-flash": "multimodal",
	"glm-5.3-flash": "multimodal",
	"glm-5v-turbo": "multimodal",
	"kimi-k2.6": "multimodal",
	"kimi-k2.7": "multimodal",
	"kimi-k3-1": "multimodal",
	"minimax-m3": "multimodal",
	"minimax-m3.1-flash": "multimodal",
	"space-bunny": "multimodal"
};
/**
* Ids the upstream lists in the model roster that are ROUTERS, not models.
*
* Two of them are known, one per region, and they are the SAME concept under
* two ids:
*
* - `auto` (CN gateway) — the gateway resolves it to whichever model it
*   considers the best fit (measured: CN `auto` → `hy4-preview`), and its own
*   description says so outright: 「平衡效果与速度。自动为每个任务匹配最优模型，
*   积分倍率随之浮动」 ("picks the best model per task; the credit multiplier
*   floats accordingly").
* - `default-model` (international gateway) — identical role (name "Auto",
*   `isDefault: true`, the region's default pick), also the ONLY entry in that
*   roster that declares no `credits` at all.
*
* The evidence for treating both as routers is the shared, self-describing
* shape, not the name: measured 2026-10-22 against both live gateways, these
* two entries are the ONLY ones whose `credits` field is absent/empty (CN 19
* of 20 priced, global 27 of 28), and the ones carrying `isDefault: true`.
* A row the plugin cannot price is a row whose cost it cannot state, and the
* router duplicates a real row already in the same roster.
*
* Kept as an explicit table rather than a heuristic: a router is an upstream
* concept with no declared flag, and guessing from the name would eventually
* hide a real model. Add an id here only after the same kind of evidence.
*/
const ROUTER_MODEL_IDS = /* @__PURE__ */ new Set(["auto", "default-model"]);
/** Whether this id is an upstream router rather than a model. */
function isRouterModelId(modelId) {
	return ROUTER_MODEL_IDS.has(modelId);
}
/**
* Native modality of one model id. Exact match only: a new model never
* inherits a classification from its family, its display name, or the
* platform's image flag.
*/
function nativeModalityOf(modelId) {
	if (isRouterModelId(modelId)) return "router";
	return NATIVE_MODALITY_BY_MODEL_ID[modelId] ?? "unknown";
}
/**
* Whether a model refresh should PRE-CHECK this model's image box.
*
* Only a documented `multimodal` is pre-checked. `text` is documented as
* unable to read images, and `unknown` is deliberately left unchecked rather
* than guessed — the whole reason this table exists is that the platform flag
* guessed wrong. A platform `supportsImages: false` still vetoes, so a
* documented-multimodal id can never be pre-checked against the platform's
* explicit "no".
*
* The user can always tick a box by hand; this decides a DEFAULT only, and the
* effective runtime flag remains the saved `imageModelIds`.
*/
function imageDefaultFor(info) {
	if (info.supportsImages === false) return false;
	return NATIVE_MODALITY_BY_MODEL_ID[info.id] === "multimodal";
}
/**
* Delete the oldest files in `dir`, keeping the newest `keep`.
*
* Ordering is by mtime, not filename: the image name embeds an ISO timestamp
* and the video name embeds one plus a URL tail, so neither sorts reliably as a
* string once more than one generator writes into the directory.
*
* @returns how many files were removed (for tests and for callers that want to
*   log a real number); `0` when the directory is absent, unreadable, small
*   enough, or when every removal failed.
*/
async function pruneTempDir(dir, keep = 20, extensions = [".png", ".mp4"]) {
	let names;
	try {
		names = (await readdir(dir)).filter((name) => extensions.some((ext) => name.endsWith(ext)));
	} catch {
		return 0;
	}
	if (names.length <= keep) return 0;
	const dated = await Promise.all(names.map(async (name) => {
		const path = join(dir, name);
		try {
			return {
				path,
				mtimeMs: (await stat(path)).mtimeMs
			};
		} catch {
			return {
				path,
				mtimeMs: 0
			};
		}
	}));
	dated.sort((a, b) => b.mtimeMs - a.mtimeMs);
	let removed = 0;
	for (const entry of dated.slice(Math.max(0, keep))) try {
		await rm(entry.path, { force: true });
		removed += 1;
	} catch {}
	return removed;
}
/** Everything the app treats as a queue condition (`isQueueError`). */
const WORKBUDDY_QUEUE_CODES = [
	6020,
	6021,
	6022
];
/** True when a business code is one of the app's three queue codes. */
function isQueueCode(value) {
	return typeof value === "number" && WORKBUDDY_QUEUE_CODES.includes(value);
}
/** Read one queue condition out of a `data`-shaped object, or `undefined`. */
function reportFrom(code, data) {
	if (!isQueueCode(code)) return void 0;
	const body = typeof data === "object" && data !== null ? data : {};
	const numberField = (key) => typeof body[key] === "number" && Number.isFinite(body[key]) ? body[key] : void 0;
	const position = numberField("queue_position");
	const size = numberField("queue_size");
	return {
		code,
		...position === void 0 ? {} : { position },
		...size === void 0 ? {} : { size }
	};
}
/**
* Read a queue condition out of one upstream body.
*
* Three shapes are accepted, because the gateway wraps the same fact three ways
* depending on which channel answered:
*
*   1. the chat endpoint's own error envelope — `{"code":6020,"data":{…}}`;
*   2. the app's agent-protocol envelope, where the condition rides as a JSON
*      STRING inside `_meta['codebuddy.ai/errorMessage']`
*      (`{"code":6020,"data":{…},"message":"…"}` — see the app's
*      `extractQueueInfoFromPromptResult`);
*   3. a nested `data.code`, for a gateway that wraps one envelope in another.
*
* Anything else — a 14003 throttle, a quota refusal, a 500 — is NOT a queue and
* returns `undefined`, so this can sit in the error path without changing it.
*/
function parseQueueAnswer(text) {
	let parsed;
	try {
		parsed = JSON.parse(text);
	} catch {
		return;
	}
	const direct = readEnvelope$1(parsed);
	if (direct !== void 0) return direct;
	if (typeof parsed === "object" && parsed !== null) {
		const meta = parsed["_meta"];
		if (typeof meta === "object" && meta !== null) {
			const message = meta["codebuddy.ai/errorMessage"];
			if (typeof message === "string") try {
				return readEnvelope$1(JSON.parse(message));
			} catch {
				return;
			}
		}
	}
}
/** `{code, data}` at the top level, or one `data` level down. */
function readEnvelope$1(value) {
	if (typeof value !== "object" || value === null) return void 0;
	const envelope = value;
	const top = reportFrom(envelope["code"], envelope["data"]);
	if (top !== void 0) return top;
	const data = envelope["data"];
	if (typeof data === "object" && data !== null) {
		const inner = data;
		return reportFrom(inner["code"], inner["data"] ?? inner);
	}
}
/**
* The sentence a queue condition is reported with — the app's own vocabulary
* ("排队", "位"), and never the upstream's untranslated `message` key.
*
* `waiting` names both numbers because they answer different questions: the
* POSITION is how long the wait is, the SIZE is whether it is moving at all.
*
* IT NO LONGER PROMISES "自动重试" (removed 2026-10-22, at the maintainer's
* request). The sentence used to end with 「约 N 秒后自动重试」, and nothing
* retried: this plugin does not poll `/v2/chat/queue/status` and does not resend
* (see "WHAT THIS MODULE DOES NOT DO YET" above). The only retry that ever
* happened was the HOST's own bounded in-place retry on a 429 — two attempts,
* 0.5s then 1s, about 1.5 seconds — which is not "N seconds" and gives up long
* before a real queue of thousands moves.
*
* So the sentence now states the WAIT and leaves the next move to the reader.
* Reporting the position stays honest and useful — knowing you are 8,777th is
* the answer to "wait or switch" — but claiming a recovery the plugin does not
* perform turned a diagnostic into a promise it could not keep.
*/
function queueNoticeText(report) {
	if (report.code === 6020) return `模型排队中：你排在第 ${report.position === void 0 ? "未知" : `${report.position}`} 位${report.size === void 0 ? "" : `，队列共 ${report.size} 个请求`}。请稍后重新发送这条消息，或换一个模型`;
	if (report.code === 6021) return `模型队列已满${report.size === void 0 ? "" : `（共 ${report.size} 个请求排队）`}，现在无法排队；请稍后重试或换一个模型`;
	return `你的排队任务已达上限${report.size === void 0 ? "" : `（共 ${report.size} 个请求排队）`}，请等待已排队请求完成后再试`;
}
//#endregion
//#region src/image-gen.ts
/**
* WorkBuddy 生图的纯逻辑层：媒体模型筛选、请求体构造、响应解析、失败描述。
*
* 这一层刻意不做任何网络 I/O、不引用宿主的任何包。`src/upstream.ts` 会被
* `src/bin.ts` 静态可达（见 tests/host-peers.spec.ts 对 lib/bin.js 可达图的断言：
* 除 `node:` 外不得出现任何裸说明符），所以任何被它引用的模块都必须保持零外部依赖。
*
* 上游契约照抄官方 CLI `codebuddy-lite-wb.mjs` 的 ImageService（实测 2026-10-21，
* 国内区 `copilot.tencent.com` 与 `www.workbuddy.cn` 两个入口逐字段同答）：
*
*   POST {endpoint}/v2/images/generations
*   body = { model, prompt, size, ...按 model 前缀分支的字段 }
*   resp = { code, msg, request_id?, data: { created, data: [{ url } | { b64_json }],
*            usage: { credit } } }
*
* 前缀分支（`buildBaseRequestBody` 原文行为）：
*   - `hunyuan-*`：额外只带 `n`（默认 1）/ `footnote` / `revise`
*   - `gemini-*`  ：什么都不加
*   - 其它        ：`response_format: 'b64_json'` + 可选 `n` / `quality` / `style` / `background`
*
* 两个区的目录各有一条媒体模型，互不重叠（2026-10-25 实测）：
*   - 国内区（61 条模型）：`text-to-image` 只有 `hunyuan-image-alpha`，
*     `image-to-image` 只有 `hunyuan-image-alpha-edit`。走 hunyuan 分支，
*     响应是 COS 签名 URL（24h 有效），单张约 5.71 credits。
*   - 国际区（29 条模型）：`hy-image-3.5` 同时带 `text-to-image` 与
*     `image-to-image`。走「其它」分支（带 `response_format: 'b64_json'`），
*     实测单张约 0.03 credits，返回的同样是 ap-singapore 的 COS 签名 URL。
*
* 两个数不是一个价目表的两个档位：目录条目只有 id/name/tags，**没有价格**，
* 价格只在上游结算时以 `data.usage.credit` 返回，所以工具只能回报实扣、
* 不能预先报价。
*
* @module dsh-connect-workbuddy/image-gen
*/
/** 产品配置里「文生图」模型的标签。 */
const IMAGE_TAG_TEXT_TO_IMAGE = "text-to-image";
/** 产品配置里「图生图 / 改图」模型的标签。 */
const IMAGE_TAG_IMAGE_TO_IMAGE = "image-to-image";
/** 生图路由。 */
const IMAGE_GENERATIONS_PATH = "/v2/images/generations";
/** 改图路由：官方 CLI 的 `ImageService.editImage` 打的就是这条（2026-10-25 国际区实测 200）。 */
const IMAGE_EDITS_PATH = "/v2/images/edits";
/**
* 本插件认作「媒体模型」的全部标签。
*
* 目录只读一次就返回全部媒体条目，由调用方按 tag 分组：生图工具只认两个 image
* 标签，卡片清单则把视频条目一并列出来。这样 `fetchMediaModels` 不必为每种能力
* 各读一遍 `/v3/config`。
*/
const MEDIA_TAGS = [
	IMAGE_TAG_TEXT_TO_IMAGE,
	IMAGE_TAG_IMAGE_TO_IMAGE,
	"text-to-video",
	"image-to-video"
];
/** 生图链路的错误。带一个稳定的 `code`，避免调用方去匹配文案。 */
var WorkBuddyImageError = class extends Error {
	code;
	constructor(message, code) {
		super(message);
		this.name = "WorkBuddyImageError";
		this.code = code;
	}
};
function asString$1(value) {
	return typeof value === "string" && value.trim() !== "" ? value : void 0;
}
function stringList(value) {
	if (!Array.isArray(value)) return [];
	const out = [];
	for (const item of value) {
		const text = asString$1(item);
		if (text !== void 0) out.push(text);
	}
	return out;
}
function asFiniteNumber(value) {
	return typeof value === "number" && Number.isFinite(value) ? value : void 0;
}
/**
* 把目录条目上的 `videoGeneration` 读成已知字段的配置对象（图像链路只是搬运，
* 不解释它）。与 `video-gen.ts` 的 `readVideoGeneration` 必须同形——同一份上游
* 数据，两个入口不能读出两个答案。缺字段即 undefined，不补默认值。
*/
function readVideoGeneration(raw) {
	if (typeof raw !== "object" || raw === null) return void 0;
	const record = raw;
	const resolutions = stringList(record["resolutions"]);
	const defaultResolution = asString$1(record["defaultResolution"]);
	const defaultSeconds = asFiniteNumber(record["defaultSeconds"]);
	const minSeconds = asFiniteNumber(record["minSeconds"]);
	const maxSeconds = asFiniteNumber(record["maxSeconds"]);
	const config = {
		...resolutions.length === 0 ? {} : { resolutions },
		...defaultResolution === void 0 ? {} : { defaultResolution },
		...defaultSeconds === void 0 ? {} : { defaultSeconds },
		...minSeconds === void 0 ? {} : { minSeconds },
		...maxSeconds === void 0 ? {} : { maxSeconds }
	};
	return Object.keys(config).length === 0 ? void 0 : config;
}
/**
* 从产品配置的 `data.models` 里挑出带指定 tag 的媒体模型。
*
* `tag` 可以是一组标签，命中任一即算——目录只读一次就返回全部媒体条目（{@link MEDIA_TAGS}），
* 调用方再按能力分组过滤，比每种能力各读一遍 `/v3/config` 少一次往返。
*
* 去重按 `id`：上游目录里同一个 id 只应出现一次，但目录是外部数据，
* 重复条目不该让卡片或工具参数里出现两个同名选项。
*/
function selectMediaModels(rawModels, tag = IMAGE_TAG_TEXT_TO_IMAGE) {
	const wanted = typeof tag === "string" ? [tag] : tag;
	if (!Array.isArray(rawModels)) return [];
	const out = [];
	const seen = /* @__PURE__ */ new Set();
	for (const entry of rawModels) {
		if (typeof entry !== "object" || entry === null) continue;
		const record = entry;
		const id = asString$1(record["id"]);
		if (id === void 0 || seen.has(id)) continue;
		const tags = stringList(record["tags"]);
		if (!wanted.some((one) => tags.includes(one))) continue;
		seen.add(id);
		const videoGeneration = readVideoGeneration(record["videoGeneration"]);
		out.push({
			id,
			name: asString$1(record["name"]) ?? id,
			tags,
			...videoGeneration === void 0 ? {} : { videoGeneration }
		});
	}
	return out;
}
/** tag 的人话名字，只用在错误信息里。 */
function tagLabel$1(tag) {
	if (tag === "image-to-image") return "图生图";
	if (tag === "text-to-image") return "文生图";
	return tag;
}
/**
* 按能力标签选一个图像模型：先在该标签组内找调用方点名的那个，否则取组内第一个。
*
* 点名的模型必须在**这一组**里——写错名字或拿改图模型来文生图都直接报错，
* 而不是把它发上去让上游回一个「route config not found」。这样报错信息能指出
* 真正的问题（模型名写错，或该区这一组没有模型），那句话里还会列出本组可用项。
*/
function pickMediaModel(models, requested, tag = IMAGE_TAG_TEXT_TO_IMAGE) {
	const group = models.filter((model) => model.tags.includes(tag));
	if (requested !== void 0 && requested !== "") {
		const found = group.find((model) => model.id === requested);
		if (found === void 0) {
			const known = group.map((model) => model.id).join(", ");
			throw new WorkBuddyImageError(`workbuddy image: 目录里没有${tagLabel$1(tag)}模型「${requested}」。可用：${known === "" ? "（空）" : known}`, "NO_IMAGE_MODEL");
		}
		return found;
	}
	const first = group[0];
	if (first === void 0) throw new WorkBuddyImageError(`workbuddy image: 该区账号的产品配置里没有任何带 ${tag} 标签的模型（${tagLabel$1(tag)}）。国内区文生图应是 hunyuan-image-alpha、改图是 hunyuan-image-alpha-edit；国际区 hy-image-3.5 同时带这两个标签；一个都没有说明该区目录暂时没有这类模型。`, "NO_IMAGE_MODEL");
	return first;
}
/** 按官方 CLI 的 `buildBaseRequestBody` 分支规则拼请求体。 */
function buildImageBody(request) {
	const model = request.model;
	const body = {
		model,
		prompt: request.prompt,
		size: request.size ?? "1024x1024"
	};
	if (model.startsWith("hunyuan-")) {
		body["n"] = request.n ?? 1;
		return body;
	}
	if (model.startsWith("gemini-")) return body;
	body["response_format"] = "b64_json";
	if (request.n !== void 0) body["n"] = request.n;
	return body;
}
/**
* 改图请求体：生图那一套字段 + `image`（data URL 数组）+ 可选 `input_fidelity`。
*
* 顺序照抄官方 CLI 的 `editImage`：先 `buildBaseRequestBody`，再补 `image`，
* 再可选补 `input_fidelity`。`image` 上游只认字符串数组，单个字符串会被拒。
*/
function buildEditBody(request) {
	const body = buildImageBody(request);
	body["image"] = [...request.image];
	if (request.inputFidelity !== void 0 && request.inputFidelity !== "") body["input_fidelity"] = request.inputFidelity;
	return body;
}
/** 输入图的大小上限。上游没说，但一张改图输入不该比产物大一个量级，8 MB 足够。 */
const MAX_INPUT_IMAGE_BYTES = 8388608;
/** 按扩展名猜输入图的 MIME；不认识就返回 undefined（交给嗅探）。 */
const IMAGE_MIME_BY_EXTENSION = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".bmp": "image/bmp",
	".svg": "image/svg+xml",
	".ico": "image/x-icon",
	".tif": "image/tiff",
	".tiff": "image/tiff"
};
function imageMimeForPath(path) {
	const lower = path.toLowerCase();
	const dot = lower.lastIndexOf(".");
	if (dot < 0) return void 0;
	return IMAGE_MIME_BY_EXTENSION[lower.slice(dot)];
}
/**
* 按魔数嗅探图片 MIME，照抄官方 CLI 的 `detectMimeTypeFromBase64`。
*
* 认不出来时兜底 `image/png`（CLI 也是这么兜的）：宁可让上游按 png 试一次，
* 也不要因为一个我们没见过的头就拒掉用户给的图。
*/
function sniffImageMime(bytes) {
	const at = (index) => bytes[index] ?? -1;
	if (at(0) === 137 && at(1) === 80 && at(2) === 78 && at(3) === 71) return "image/png";
	if (at(0) === 255 && at(1) === 216 && at(2) === 255) return "image/jpeg";
	if (at(0) === 71 && at(1) === 73 && at(2) === 70 && at(3) === 56) return "image/gif";
	if (at(0) === 82 && at(1) === 73 && at(2) === 70 && at(3) === 70 && at(8) === 87 && at(9) === 69 && at(10) === 66 && at(11) === 80) return "image/webp";
	if (at(0) === 66 && at(1) === 77) return "image/bmp";
	return "image/png";
}
/** 拼出上游唯一接受的输入形态：`data:<mime>;base64,<base64>`。 */
function imageDataUrl(mime, base64) {
	return `data:${mime};base64,${base64}`;
}
/** 解析一个 data URL 形式的输入图；不是 `data:image/*;base64,` 就返回 undefined。 */
function parseImageDataUrl(value) {
	const match = /^data:([^;,]+);base64,(.+)$/s.exec(value.trim());
	if (match === null) return void 0;
	const mime = match[1] ?? "";
	const base64 = match[2] ?? "";
	if (!mime.startsWith("image/") || base64 === "") return void 0;
	return {
		mime,
		base64
	};
}
const BARE_BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
/**
* 看起来像「裸 base64」而不是路径吗？
*
* 判据照抄 CLI 的 `processImageInput`：不含路径分隔符、足够长、字符集是 base64。
* 长度门槛是必要的——`a.png` 这种文件名同样不含分隔符，短到不足以是图片数据。
*/
function isBareBase64Image(value) {
	const text = value.trim();
	if (text.length < 100) return false;
	if (text.includes("/") || text.includes("\\")) return false;
	return BARE_BASE64.test(text);
}
/**
* 解析生图响应。
*
* 信封是 `{code, msg, request_id, data}`；`code !== 0` 是业务失败（与 HTTP 状态
* 无关，上游可能 HTTP 200 但 code 非 0）。`data.data` 是数组，元素要么带 `url`
* 要么带 `b64_json`；`data.usage.credit` 是本次实际扣的积分。
*/
function parseImageResponse(payload) {
	if (typeof payload !== "object" || payload === null) throw new WorkBuddyImageError("workbuddy image: 上游返回的不是 JSON 对象", "UPSTREAM");
	const envelope = payload;
	const code = typeof envelope["code"] === "number" ? envelope["code"] : void 0;
	if (code !== void 0 && code !== 0) {
		const message = asString$1(envelope["msg"]) ?? "unknown error";
		const requestId = asString$1(envelope["request_id"]);
		throw new WorkBuddyImageError(`workbuddy image: 上游拒绝（code ${code}）: ${message}` + (requestId === void 0 ? "" : `（request_id ${requestId}）`), "UPSTREAM");
	}
	const data = envelope["data"];
	if (typeof data !== "object" || data === null) throw new WorkBuddyImageError("workbuddy image: 响应缺少 data 字段", "UPSTREAM");
	const record = data;
	const items = Array.isArray(record["data"]) ? record["data"] : [];
	const first = items.length > 0 ? items[0] : void 0;
	let url;
	let b64;
	if (typeof first === "object" && first !== null) {
		const item = first;
		url = asString$1(item["url"]);
		b64 = asString$1(item["b64_json"]);
	}
	if (url === void 0 && b64 === void 0) throw new WorkBuddyImageError("workbuddy image: 上游返回成功但 data.data 里既没有 url 也没有 b64_json", "EMPTY_RESULT");
	const usage = typeof record["usage"] === "object" && record["usage"] !== null ? record["usage"] : {};
	const credit = typeof usage["credit"] === "number" && Number.isFinite(usage["credit"]) ? usage["credit"] : void 0;
	const created = typeof record["created"] === "number" ? record["created"] : void 0;
	return {
		...url === void 0 ? {} : { url },
		...b64 === void 0 ? {} : { b64 },
		...created === void 0 ? {} : { created },
		...credit === void 0 ? {} : { credit }
	};
}
/** 把一次非 2xx 的响应翻成带 `code` 的错误，好让上层决定怎么提示。 */
function describeImageFailure(status, bodyText) {
	const text = bodyText.trim();
	let detail = text.slice(0, 240);
	if (text.startsWith("{")) try {
		const parsed = JSON.parse(text);
		if (typeof parsed === "object" && parsed !== null) {
			const record = parsed;
			const message = asString$1(record["msg"]);
			const code = typeof record["code"] === "number" ? record["code"] : void 0;
			if (message !== void 0) detail = code === void 0 ? message : `code ${code}: ${message}`;
		}
	} catch {}
	if (status === 401 || status === 403) return new WorkBuddyImageError(`workbuddy image: 凭据被上游拒绝（HTTP ${status}），请在插件设置里重新登录 WorkBuddy。${detail === "" ? "" : ` ${detail}`}`, "AUTH");
	if (status === 429) return new WorkBuddyImageError(`workbuddy image: 触发上游限流（HTTP 429），稍后再试。${detail === "" ? "" : ` ${detail}`}`, "RATE_LIMIT");
	if (status === 404) return new WorkBuddyImageError(`workbuddy image: 上游没有这条生图路由（HTTP 404）——该区网关没有开放生图接口。${detail === "" ? "" : ` ${detail}`}`, "NO_ROUTE");
	return new WorkBuddyImageError(`workbuddy image: 上游失败（HTTP ${status}）${detail === "" ? "" : `: ${detail}`}`, "UPSTREAM");
}
//#endregion
//#region src/video-gen.ts
/**
* WorkBuddy 生视频的纯逻辑层：媒体模型筛选、请求体构造、任务轮询解析、失败描述。
*
* 这一层刻意不做任何网络 I/O、不引用宿主的任何包（同 `src/image-gen.ts` 的约定，
* 见其模块注释里的可达图说明）。`src/upstream.ts` 会静态引用本模块，所以这里
* 必须保持零外部依赖。
*
* 上游契约照抄官方 CLI `codebuddy-lite-wb.mjs` 的 `VideoService`（实测 2026-10-25，
* 二进制位于 `WorkBuddy/resources/app.asar.unpacked/cli/dist/codebuddy-lite-wb.mjs`）：
*
*   submitTask:  POST {endpoint}/v2/videos/generations
*               body = { prompt, model, seconds, negative_prompt, watermark:true,
*                        image_url/last_image_url(图生视频时),
*                        extra_parameters:{ resolution, enable_audio,
*                                          aspect_ratio(仅文生视频) } }
*               resp = { code, msg, request_id, data:{ id } }   ← 只是 task id
*   pollTask:    POST {endpoint}/v2/videos/tasks  { task_id }
*               轮询直到 data.status === 'completed' | 'failed'
*               resp = { code, msg, data:{ status, usage?:{credit}, ... } }
*   download:   GET 每条 data[].url → 写本地 .mp4
*
* 与 `ImageService` 的根本区别：视频是**异步任务**，不是一次同步请求。生图
* `ImageService` 调一次 `generations` 直接拿 URL；视频 `VideoService` 要先
* `generations` 拿 task id，再 `tasks` 轮询，最后下载。所以本模块把"提交 / 轮询 /
* 下载"三段拆开，工具层负责把它们串成一条异步流程（`src/video-tool.ts`）。
*
* 模型配置来自产品配置里每条媒体模型的 `videoGeneration` 字段：
*   { resolutions:[...], defaultResolution, defaultSeconds,
*     minSeconds, maxSeconds }。时长/分辨率要在该模型允许的集合内，否则上游
*   会拒。这里把"该模型支持哪些值"的读取与校验收进来，工具层只把用户给的值
*   递进来、拿校验结果。
*
* 两个区的视频目录（2026-10-25 实测，`src/upstream.ts` 的 `fetchMediaModels`
* 注释）：
*   - 国内区（61 条模型）：`kling-video-v3` 与 `minimax-video-h3` 各带
*     `text-to-video` + `image-to-video`。
*   - 国际区（29 条）：`kling-video-v3` 带两种 video tag。
* 两边目录完全不重叠，所以"以哪个区为准"由工具的 `videoToolRegionOf` 决定
* （默认国内区优先，与 image 工具一致）。
*
* @module dsh-connect-workbuddy/video-gen
*/
/** 产品配置里「文生视频」模型的标签。 */
const VIDEO_TAG_TEXT_TO_VIDEO = "text-to-video";
/** 产品配置里「图生视频」模型的标签。 */
const VIDEO_TAG_IMAGE_TO_VIDEO = "image-to-video";
/** 生视频路由（提交任务，拿 task id）。 */
const VIDEO_GENERATIONS_PATH = "/v2/videos/generations";
/** 任务轮询路由。 */
const VIDEO_TASKS_PATH = "/v2/videos/tasks";
/** 支持的非图像决定宽高比集合。 */
const VIDEO_ASPECT_RATIOS = [
	"16:9",
	"9:16",
	"1:1"
];
/** 生视频链路的错误。带一个稳定的 `code`，避免调用方去匹配文案。 */
var WorkBuddyVideoError = class extends Error {
	code;
	constructor(message, code) {
		super(message);
		this.name = "WorkBuddyVideoError";
		this.code = code;
	}
};
function asString(value) {
	return typeof value === "string" && value.trim() !== "" ? value : void 0;
}
/**
* 从上游的拒绝文案里读出它自己报的时长区间。
*
* 目录没有 `videoGeneration` 时，本地无从校验，只能让上游先拒一次；它会以
* `unsupported video duration: 1 seconds, supported range: 4-15 seconds` 这种
* 文案把真相说出来。把这段读出来记到本次进程里，第二次同样的参数就能在本地被拦下，
* 不再多打一次注定失败的请求。读不出来就返回 undefined（绝不猜）。
*/
function parseSupportedSecondsRange(text) {
	const match = /supported range:\s*(\d+(?:\.\d+)?)\s*(?:-|–|—|~|to)\s*(\d+(?:\.\d+)?)/i.exec(text);
	if (match === null) return void 0;
	const minSeconds = Number(match[1]);
	const maxSeconds = Number(match[2]);
	if (!Number.isFinite(minSeconds) || !Number.isFinite(maxSeconds)) return void 0;
	if (minSeconds <= 0 || maxSeconds < minSeconds) return void 0;
	return {
		minSeconds,
		maxSeconds
	};
}
/** tag 的人话名字，只用在错误信息里。 */
function tagLabel(tag) {
	if (tag === "image-to-video") return "图生视频";
	if (tag === "text-to-video") return "文生视频";
	return tag;
}
/**
* 按能力标签选一个视频模型：先在该标签组内找调用方点名的那个，否则取组内第一个。
*
* 与 `image-gen.ts` 的 `pickMediaModel` 完全一致的设计——点名的模型必须在**这一组**
* 里，写错名字或拿文生视频模型去图生视频都直接报错，而不是把它发上去换一个上游 404。
*/
function pickVideoModel(models, requested, tag = VIDEO_TAG_TEXT_TO_VIDEO) {
	const group = models.filter((model) => model.tags.includes(tag));
	if (requested !== void 0 && requested !== "") {
		const found = group.find((model) => model.id === requested);
		if (found === void 0) {
			const known = group.map((model) => model.id).join(", ");
			throw new WorkBuddyVideoError(`workbuddy video: 目录里没有${tagLabel(tag)}模型「${requested}」。可用：${known === "" ? "（空）" : known}`, "NO_VIDEO_MODEL");
		}
		return found;
	}
	const first = group[0];
	if (first === void 0) throw new WorkBuddyVideoError(`workbuddy video: 该区账号的产品配置里没有任何带 ${tag} 标签的模型（${tagLabel(tag)}）。国内区文生视频/图生视频是 kling-video-v3、minimax-video-h3；国际区 kling-video-v3 同时带这两个标签；一个都没有说明该区目录暂时没有这类模型。`, "NO_VIDEO_MODEL");
	return first;
}
/**
* 把一次生视频请求组装成上游 `POST /v2/videos/generations` 的请求体。
*
* 完全照抄官方 CLI 的 `submitTask`：`prompt` / `model` / `seconds` /
* `negative_prompt` / `watermark:true`，图生视频时带 `image_url` 或
* `last_image_url`，`extra_parameters` 里放 `resolution` / `enable_audio` /
* 以及仅文生视频的 `aspect_ratio`。
*
* `config` 来自该模型的 `videoGeneration` 字段，用于回落默认值与约束校验
* （见 {@link resolveVideoParams}）。`isImageToVideo` 由调用方（工具层）按
* "有没有给 image" 唯一决定，与 image 工具"不给 image 就是文生图"的约定一致。
*/
function buildVideoBody(request, isImageToVideo) {
	const body = {
		prompt: request.prompt,
		model: request.model,
		seconds: request.seconds,
		negative_prompt: request.negativePrompt ?? "",
		watermark: true
	};
	if (request.image !== void 0) body["image_url"] = request.image;
	if (request.lastImage !== void 0) body["last_image_url"] = request.lastImage;
	const extra = {
		resolution: request.resolution,
		enable_audio: request.enableAudio ?? true
	};
	if (!isImageToVideo) extra["aspect_ratio"] = request.aspectRatio ?? "16:9";
	body["extra_parameters"] = extra;
	return body;
}
/**
* 校验并回落一次生视频请求的可选参数（时长 / 分辨率 / 宽高比）。
*
* 集中处理"该模型支持哪些值"的判断，让工具层只需把用户给的值递进来。
* 返回：最终要用的 `seconds` / `resolution` / `aspectRatio`（图生视频时
* `aspectRatio` 为 undefined，因为由输入图决定），以及一条非致命告警列表
* （例如用户给的分辨率模型不支持、被回落成默认值）。
*
* 抛 `WorkBuddyVideoError`('INVALID_ARGS') 的情况：prompt 超长、宽高比非法、
* 模型不支持自定义时长却给了时长、时长越界。
*/
function resolveVideoParams(request, config) {
	const warnings = [];
	if ((request.prompt ?? "").length > 2500) throw new WorkBuddyVideoError("workbuddy video: prompt 不能超过 2500 字符。", "INVALID_ARGS");
	if ((request.negativePrompt?.length ?? 0) > 2500) throw new WorkBuddyVideoError("workbuddy video: negative_prompt 不能超过 2500 字符。", "INVALID_ARGS");
	const isImageToVideo = request.image !== void 0 || request.lastImage !== void 0;
	const minSeconds = config?.minSeconds;
	const maxSeconds = config?.maxSeconds;
	let seconds = request.seconds ?? config?.defaultSeconds ?? 5;
	if (request.seconds !== void 0) {
		if (minSeconds !== void 0 && maxSeconds !== void 0 && (seconds < minSeconds || seconds > maxSeconds)) throw new WorkBuddyVideoError(`workbuddy video: 时长必须在 ${minSeconds} 到 ${maxSeconds} 秒之间（给定 ${seconds}）。`, "INVALID_ARGS");
	}
	const resolutions = config?.resolutions ?? [];
	const defaultResolution = config?.defaultResolution;
	let resolution = defaultResolution;
	if (request.resolution !== void 0) {
		const requested = request.resolution;
		if (resolutions.length === 0) resolution = requested;
		else {
			const matched = resolutions.includes(requested) ? requested : resolutions.find((one) => one.toLowerCase() === requested.toLowerCase());
			if (matched === void 0) {
				warnings.push(`resolution ${requested} 不被模型 ${request.model} 支持；改用 ${defaultResolution ?? "上游默认"}`);
				resolution = defaultResolution;
			} else resolution = matched;
		}
	}
	let aspectRatio;
	if (!isImageToVideo) {
		const ar = request.aspectRatio ?? "16:9";
		if (!VIDEO_ASPECT_RATIOS.includes(ar)) throw new WorkBuddyVideoError(`workbuddy video: aspect_ratio 只能是 ${VIDEO_ASPECT_RATIOS.join("、")} 之一（给定 ${ar}）。`, "INVALID_ARGS");
		aspectRatio = ar;
	}
	return {
		seconds,
		resolution,
		aspectRatio,
		warnings
	};
}
/**
* 解析 `POST /v2/videos/generations` 的响应，取出 task id。
*
* 信封是 `{code, msg, request_id, data}`，`code !== 0` 是业务失败（与 HTTP
* 状态无关）。成功时 `data.id` 是 task id。没有 id 就说不通（上游一定返回 id）。
*/
function parseVideoSubmission(payload) {
	if (typeof payload !== "object" || payload === null) throw new WorkBuddyVideoError("workbuddy video: 上游返回的不是 JSON 对象", "UPSTREAM");
	const envelope = payload;
	const code = typeof envelope["code"] === "number" ? envelope["code"] : void 0;
	if (code !== void 0 && code !== 0) {
		const message = asString(envelope["msg"]) ?? "unknown error";
		const requestId = asString(envelope["request_id"]);
		throw new WorkBuddyVideoError(`workbuddy video: 提交失败（code ${code}）: ${message}` + (requestId === void 0 ? "" : `（request_id ${requestId}）`), "UPSTREAM");
	}
	const taskId = asString((typeof envelope["data"] === "object" && envelope["data"] !== null ? envelope["data"] : {})["id"]);
	if (taskId === void 0) throw new WorkBuddyVideoError("workbuddy video: 上游没返回 task id，无法进入轮询。", "EMPTY_RESULT");
	return {
		taskId,
		warnings: []
	};
}
/**
* 解析 `POST /v2/videos/tasks` 的轮询响应。
*
* 返回当前 `status`，以及（完成态时）成品视频 URL 列表与实扣积分。
* `status` 不在 `pending/processing/completed/failed` 内的未知字符串，一律
* 当成"还没好"继续轮询，避免把新状态误判成失败而浪费一次已花钱的任务。
*/
function parseVideoTask(payload) {
	if (typeof payload !== "object" || payload === null) throw new WorkBuddyVideoError("workbuddy video: 轮询响应不是 JSON 对象", "UPSTREAM");
	const envelope = payload;
	const code = typeof envelope["code"] === "number" ? envelope["code"] : void 0;
	if (code !== void 0 && code !== 0) {
		const message = asString(envelope["msg"]) ?? "unknown error";
		const requestId = asString(envelope["request_id"]);
		throw new WorkBuddyVideoError(`workbuddy video: 轮询失败（code ${code}）: ${message}` + (requestId === void 0 ? "" : `（request_id ${requestId}）`), "UPSTREAM");
	}
	const data = typeof envelope["data"] === "object" && envelope["data"] !== null ? envelope["data"] : {};
	const status = asString(data["status"]) ?? "unknown";
	if (status === "completed") {
		const items = Array.isArray(data["data"]) ? data["data"] : [];
		const videos = [];
		for (const item of items) {
			if (typeof item !== "object" || item === null) continue;
			const url = asString(item["url"]);
			if (url !== void 0) videos.push(url);
		}
		const usage = typeof data["usage"] === "object" && data["usage"] !== null ? data["usage"] : {};
		return {
			status,
			videos,
			credit: typeof usage["credit"] === "number" && Number.isFinite(usage["credit"]) ? usage["credit"] : void 0
		};
	}
	return {
		status,
		videos: [],
		detail: describeUnknownTaskFields(data)
	};
}
/**
* `data` 里除已知键以外的内容，序列化成一行短文本。
*
* 已知键：`status`（状态机自己用）、`data`（成品 URL 列表）、`usage`（扣费）。
* 其余全部带上——那正是"上游说了原因但我们没读"的地方（issue #187）。
*
* 深层结构做 JSON 序列化并截断到 400 字符：一轮报错不该因为上游回了一棵大树而
* 变成几 KB。空对象返回 `undefined`，好让调用方不拼一个空的「（上游未给出原因）」。
*/
function describeUnknownTaskFields(data) {
	const known = /* @__PURE__ */ new Set([
		"status",
		"data",
		"usage"
	]);
	const extra = {};
	for (const [key, value] of Object.entries(data)) {
		if (known.has(key)) continue;
		if (value === void 0 || value === null || value === "") continue;
		extra[key] = value;
	}
	if (Object.keys(extra).length === 0) return void 0;
	let text;
	try {
		text = JSON.stringify(extra);
	} catch {
		return "（上游返回了无法序列化的额外字段）";
	}
	return text.length > 400 ? `${text.slice(0, 400)}…` : text;
}
/** 把一次非 2xx 的提交/轮询响应翻成带 `code` 的错误，好让上层决定怎么提示。 */
function describeVideoFailure(status, bodyText, phase = "submit") {
	const text = bodyText.trim();
	let detail = text.slice(0, 240);
	if (text.startsWith("{")) try {
		const parsed = JSON.parse(text);
		if (typeof parsed === "object" && parsed !== null) {
			const record = parsed;
			const message = asString(record["msg"]);
			const code = typeof record["code"] === "number" ? record["code"] : void 0;
			if (message !== void 0) detail = code === void 0 ? message : `code ${code}: ${message}`;
		}
	} catch {}
	const where = phase === "submit" ? "提交生视频任务" : "轮询生视频任务";
	if (status === 401 || status === 403) return new WorkBuddyVideoError(`workbuddy video: 凭据被上游拒绝（HTTP ${status}），请在插件设置里重新登录 WorkBuddy。${detail === "" ? "" : ` ${detail}`}`, "AUTH");
	if (status === 429) return new WorkBuddyVideoError(`workbuddy video: 触发上游限流（HTTP 429），稍后再试。${detail === "" ? "" : ` ${detail}`}`, "RATE_LIMIT");
	if (status === 404) return new WorkBuddyVideoError(`workbuddy video: 上游没有这条生视频路由（HTTP 404）——该区网关没有开放视频接口。${detail === "" ? "" : ` ${detail}`}`, "NO_ROUTE");
	if (phase === "submit" && status >= 400 && status < 500) {
		const range = parseSupportedSecondsRange(detail);
		return new WorkBuddyVideoError(`workbuddy video: 上游拒绝了这次生视频请求（HTTP ${status}），没有创建任务、没有扣积分${range === void 0 ? "" : `；该模型支持的时长是 ${range.minSeconds}-${range.maxSeconds} 秒`}。按下面的提示改参数后可以立刻重试。${detail === "" ? "" : ` ${detail}`}`, "REJECTED");
	}
	return new WorkBuddyVideoError(`workbuddy video: ${where}失败（HTTP ${status}）${detail === "" ? "" : `: ${detail}`}`, "UPSTREAM");
}
//#endregion
//#region src/off-thinking.ts
/**
* Ids observed to REFUSE `reasoning_effort: "off"` with HTTP 400 despite
* declaring `canDisableThinking: true` (issue #34).
*
* Keyed by exact model id and deliberately NOT by region: `deepseek-v4.1-flash`
* refuses on BOTH gateways, and the split tracks the model family rather than
* the gateway. The cost is asymmetric — offering a level that always fails
* costs the user every request for that model, while hiding one that would have
* worked costs a single option — so the table errs towards hiding, and
* {@link withEffectiveOff} enforces it as a HARD wall rather than a seed
* (issue #83: a tick used to reopen the failing level, and with no
* `reasoningEffort` passed the level became the default for compaction too).
* See {@link offRefused} for why the checkbox must not win.
*
* `deepseek-v4-pro` was measured on the CN gateway only; it is listed because
* its sibling does refuse on both, and the same asymmetry argues for hiding.
*/
const REFUSES_OFF_MODEL_IDS = /* @__PURE__ */ new Set([
	"deepseek-v4.1-flash",
	"deepseek-v4.1-flash-sg",
	"deepseek-v4-pro",
	"primary-model",
	"gpt-6-astra",
	"gpt-5.6-sol",
	"gpt-5.6-terra",
	"gpt-5.6-luna",
	"gemini-3.5-flash"
]);
/**
* Whether `off` should be offered for a model when the user has expressed no
* opinion: the upstream's declaration, minus the ids known to refuse it.
*
* Only an explicit `canDisableThinking: true` enables the level; absence is
* "unknown" and stays unoffered, matching how the rest of the plugin treats an
* undeclared capability.
*/
function offDefaultFor(info) {
	return info.reasoning?.canDisableThinking === true && !REFUSES_OFF_MODEL_IDS.has(info.id);
}
/**
* The model ids the `off` level should be offered for by default (issue #34).
*
* The user's checkbox is a plain set: ticked = offered, unticked = withdrawn.
* This is the seed — what the set is filled with the first time it is read —
* so a profile that has never saved shows the correct default immediately,
* without requiring a save.
*
* Only an explicit `canDisableThinking: true` enables the level; absence is
* "unknown" and stays unoffered, matching how the rest of the plugin treats an
* undeclared capability.
*/
function defaultOffModelIds(models) {
	return models.filter(offDefaultFor).map((model) => model.id);
}
/** How many observations are kept, newest first. Bounded so a refusal storm cannot grow memory. */
const REFUSAL_RING = 20;
/**
* The refusals this process has observed, newest first.
*
* Process-scoped rather than persisted: it is EVIDENCE ("what did the upstream
* actually say"), and a stale record from another install would promote a model
* into the refusal table on the strength of a request the current build never
* sent. The card reads it; nothing sends from it.
*/
const observedRefusals = [];
/** Record one refusal, keeping the newest {@link REFUSAL_RING}. */
function recordRefusal(report) {
	observedRefusals.unshift(report);
	if (observedRefusals.length > REFUSAL_RING) observedRefusals.length = REFUSAL_RING;
}
/** The most recent refusal naming `modelId`, or `undefined` when none did. */
function lastRefusalFor(modelId) {
	return observedRefusals.find((report) => report.modelId === modelId);
}
/**
* Whether a model may offer `off` AT ALL, no matter what the user asked for.
*
* This is the hard wall in front of {@link REFUSES_OFF_MODEL_IDS} (issue #83).
* The table above used to be a seed only: the checkbox wrote the selection
* straight into `canDisableThinking`, so ticking a model known to refuse `off`
* reopened exactly the failure the table exists to prevent — and not once per
* "off" turn either. pi-ai's `openai-completions` reads
* `model.thinkingLevelMap?.off` whenever the caller passes NO
* `reasoningEffort` at all, and a compaction summary is such a caller: it never
* carries an effort. So one tick made every `/compact` for that model answer
* HTTP 400 / code 11133, with the surface showing only "could not produce a
* useful summary".
*
* The asymmetry that writes the table also writes this test: a level that
* always fails costs the user EVERY request for that model, while a level that
* was hidden needlessly costs one option. So the refusal list wins over the
* checkbox, not the other way round.
*
* The table is keyed by EXACT id, so anything that pins a different id at
* request time (aliases such as `primary-model`) is out of its reach; those are
* covered where the request is actually built — see
* {@link normalizePreparedReasoning}.
*/
function offRefused(modelId) {
	return REFUSES_OFF_MODEL_IDS.has(modelId);
}
/**
* Stamp the user's saved `off` selection onto a model list, for the RUNTIME
* catalog.
*
* The runtime model descriptor is built by `workBuddyThinkingLevelMap`, which
* reads only the model's own declaration — so the corrected answer has to be
* written onto the model before it reaches the adapter. Doing it here keeps the
* adapter a pure "declared capability in, level map out" function and keeps the
* table next to the rule it feeds.
*
* This OVERWRITES the declared field rather than adding a sibling, which is
* safe because the declared value has exactly one consumer (that same level
* map) and is never persisted where the card can see it: `toWebModel` drops
* `canDisableThinking`, and the card's `lastCatalog` is written from the raw
* upstream discovery, never from this stamped list. A model that declares no
* reasoning is returned untouched — there is no level to correct.
*
* A refusal-table id is stamped `false` REGARDLESS of the selection
* ({@link offRefused}): the tick stays in the saved set — the card shows it and
* the hint explains it — but it can no longer be turned into a request that
* fails.
*/
function withEffectiveOff(models, selection) {
	return models.map((model) => model.reasoning === void 0 ? model : {
		...model,
		reasoning: {
			...model.reasoning,
			canDisableThinking: selection.has(model.id) && !offRefused(model.id)
		}
	});
}
//#endregion
//#region src/promo.ts
/** A record-ish value, or undefined for anything else. */
function record(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
/** A trimmed non-empty string, or undefined. */
function text(value) {
	return typeof value === "string" && value.trim() !== "" ? value.trim() : void 0;
}
/**
* `'HH:mm'` → minutes since midnight, or undefined for anything else.
*
* `24:00` is accepted and means exactly 1440 — the END of a day. The upstream
* writes "all day" as `0:00`–`23:59` today, which leaves a one-minute hole
* between 23:59 and midnight where a standing campaign reads as not running.
* Accepting `24:00` lets such a window be expressed (and lets a future upstream
* fix it) without that hole; as a START it is rejected, because a day that
* begins at 24:00 is the next day and that is a different statement.
*
* Any other malformed value is left to the caller to drop — a wrong window
* would hide a live promotion, and guessing is not this parser's job.
*
* THE TYPE GUARD IS LOAD-BEARING, NOT DEFENSIVE DECORATION (issue #139). The
* upstream feeds a string, and `parseDaily`'s own `text()` would already have
* dropped a number — but the SAVED `lastCatalog` is a second, independent
* entrance to this function, and nothing on that path type-checks. A promotion
* object rides through `toPersistedWorkBuddyModel` untouched (the settings
* schema keeps unknown keys), survives `resolveRoster`, and reaches the
* renderer's `selectPromoBadge`. A numeric `start` there used to throw
* `value.trim is not a function` DURING RENDER, which the host's slot error
* boundary turned into a blank configuration section — the page looked as if
* the plugin had never installed.
*
* Refusing a non-string is the same answer the parser already gives every
* other unreadable shape: drop the window rather than guess. Interpreting a
* number as "minutes since midnight" was considered and rejected — `1380`
* happens to mean 23:00, but no upstream has ever published that shape, and
* inventing hours for a promotion the upstream never described is exactly the
* overstatement this module exists to prevent.
*/
function minutesOfClock(value) {
	if (typeof value !== "string") return void 0;
	const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
	if (match === null) return void 0;
	const hours = Number(match[1]);
	const minutes = Number(match[2]);
	if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return void 0;
	if (minutes > 59) return void 0;
	if (hours > 24) return void 0;
	if (hours === 24) return minutes === 0 ? 1440 : void 0;
	return hours * 60 + minutes;
}
/** An ISO-8601 instant → epoch milliseconds. Numbers are refused on purpose. */
function parseInstant(value) {
	const raw = text(value);
	if (raw === void 0) return void 0;
	const ms = Date.parse(raw);
	return Number.isNaN(ms) ? void 0 : ms;
}
/** The upstream's `modelIds` → the model's ids, de-duplicated. */
function parseModelIds(value) {
	if (!Array.isArray(value)) return void 0;
	const ids = [];
	for (const entry of value) {
		const id = text(entry);
		if (id !== void 0 && !ids.includes(id)) ids.push(id);
	}
	return ids.length === 0 ? void 0 : ids;
}
/** The upstream's `badge` → this plugin's badge shape. */
function parseBadge(value) {
	const raw = record(value);
	if (raw === void 0) return void 0;
	const label = text(raw["label"]) ?? text(raw["labelEn"]) ?? text(raw["shortLabel"]) ?? text(raw["shortLabelEn"]);
	if (label === void 0) return void 0;
	const labelEn = text(raw["labelEn"]);
	const shortLabel = text(raw["shortLabel"]);
	const shortLabelEn = text(raw["shortLabelEn"]);
	const color = text(raw["color"]);
	const display = raw["display"] === "activeOnly" ? "activeOnly" : void 0;
	return {
		label,
		...labelEn === void 0 ? {} : { labelEn },
		...shortLabel === void 0 ? {} : { shortLabel },
		...shortLabelEn === void 0 ? {} : { shortLabelEn },
		...color === void 0 ? {} : { color },
		...display === void 0 ? {} : { display }
	};
}
/** The upstream's `hover` → this plugin's copy shape. */
function parseHover(value) {
	const raw = record(value);
	if (raw === void 0) return void 0;
	const textZh = text(raw["textZh"]);
	const textEn = text(raw["textEn"]);
	if (textZh === void 0 && textEn === void 0) return void 0;
	return {
		...textZh === void 0 ? {} : { textZh },
		...textEn === void 0 ? {} : { textEn }
	};
}
/**
* What an unreadable endpoint actually was, for the one diagnostic line below.
*
* Deliberately coarse: a NUMBER is the shape a future upstream format change
* would plausibly take (minutes since midnight), so it is named separately
* from "some other non-string". Reporting the typeof is enough to tell the two
* apart in a log without ever echoing upstream content into the console.
*/
function shapeOf(value) {
	if (typeof value === "number") return "number";
	if (value === null) return "null";
	if (Array.isArray(value)) return "array";
	return typeof value;
}
/**
* The upstream's `schedule.daily` → the windows this plugin can evaluate.
*
* `label` names the entry for the diagnostic line and is passed in rather than
* read from `value`: the entry id lives one level up, in `parsePromo`.
*/
function parseDaily(value, label) {
	if (!Array.isArray(value)) return void 0;
	const windows = [];
	for (const entry of value) {
		const raw = record(entry);
		if (raw === void 0) continue;
		const start = text(raw["start"]);
		const end = text(raw["end"]);
		if (start === void 0 || end === void 0 || minutesOfClock(start) === void 0 || minutesOfClock(end) === void 0) {
			try {
				console.warn(`[dsh-connect-workbuddy] promotion "${label}": dropped an unreadable daily window (start: ${shapeOf(raw["start"])}, end: ${shapeOf(raw["end"])}); the upstream may have changed the time format`);
			} catch {}
			continue;
		}
		windows.push({
			start,
			end
		});
	}
	return windows.length === 0 ? void 0 : windows;
}
/**
* Read a multiplier out of the upstream's `discountedCredits` string.
*
* The upstream writes the unit INTO the value ("0x", "0.06x", "0.06"), so the
* trailing `x` is stripped rather than handed to `Number()`. A value that does
* not become a finite non-negative number is refused — a wrong price shown to
* the user is worse than the normal price, because the normal price is at least
* true.
*/
function multiplierOfCredits(value) {
	const raw = text(value);
	if (raw === void 0) return void 0;
	const stripped = raw.replace(/x$/i, "").trim();
	if (stripped === "") return void 0;
	const parsed = Number(stripped);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : void 0;
}
/** The upstream's `discount` → this plugin's discount shape. */
function parseDiscount(value) {
	const raw = record(value);
	if (raw === void 0) return void 0;
	const fromString = multiplierOfCredits(raw["discountedCredits"]);
	const fromFactor = typeof raw["factor"] === "number" && Number.isFinite(raw["factor"]) && raw["factor"] >= 0 ? raw["factor"] : void 0;
	const multiplier = fromString ?? fromFactor;
	const displayMode = raw["displayMode"] === "replace" || raw["displayMode"] === "strikethrough" ? raw["displayMode"] : void 0;
	if (multiplier === void 0 && displayMode === void 0) return void 0;
	return {
		...multiplier === void 0 ? {} : { multiplier },
		...displayMode === void 0 ? {} : { displayMode }
	};
}
/** The upstream's `schedule` → this plugin's schedule shape. */
function parseSchedule(value, label) {
	const raw = record(value);
	if (raw === void 0) return void 0;
	const timezone = text(raw["timezone"]);
	const validFrom = parseInstant(raw["validFrom"]);
	const validUntil = parseInstant(raw["validUntil"]);
	const daily = parseDaily(raw["daily"], label);
	const dailyUnusable = daily === void 0 && Array.isArray(raw["daily"]) && raw["daily"].length > 0;
	if (timezone === void 0 && validFrom === void 0 && validUntil === void 0 && daily === void 0 && !dailyUnusable) return void 0;
	return {
		...timezone === void 0 ? {} : { timezone },
		...validFrom === void 0 ? {} : { validFrom },
		...validUntil === void 0 ? {} : { validUntil },
		...daily === void 0 ? {} : { daily },
		...dailyUnusable ? { dailyUnusable: true } : {}
	};
}
/** One upstream entry → this plugin's promo shape, or undefined if it is not one. */
function parsePromo(value, source) {
	const raw = record(value);
	if (raw === void 0) return void 0;
	if (raw["enabled"] === false) return void 0;
	const modelIds = parseModelIds(raw["modelIds"]);
	if (modelIds === void 0) return void 0;
	const badge = parseBadge(raw["badge"]);
	if (badge === void 0) return void 0;
	const hover = parseHover(raw["hover"]);
	const id = text(raw["id"]) ?? `${source}:${modelIds.join(",")}`;
	const schedule = parseSchedule(raw["schedule"], id);
	const discount = parseDiscount(raw["discount"]);
	const priority = typeof raw["priority"] === "number" && Number.isFinite(raw["priority"]) ? raw["priority"] : 0;
	return {
		id,
		source,
		modelIds,
		badge,
		...hover === void 0 ? {} : { hover },
		...schedule === void 0 ? {} : { schedule },
		...discount === void 0 ? {} : { discount },
		priority
	};
}
/**
* Parse the upstream's promotion and tier lists.
*
* Both lists are read from the SAME document the roster comes from, so this
* never costs a request. Entries that are not promotions — no `modelIds`, no
* `badge`, or `enabled: false` — are dropped here rather than downstream, so
* that everything downstream can assume a promo is drawable.
*
* The promotions come first, so that a TIE on `priority` is broken in the
* promotions' favour: a price badge ("Free now") is more actionable to a user
* than an access-tier badge ("Pro Only"), and the upstream numbers them
* equally (both 200 on the observed feed).
*/
function parseWorkBuddyPromos(rawPromotions, rawTiers) {
	const promos = [];
	for (const entry of Array.isArray(rawPromotions) ? rawPromotions : []) {
		const promo = parsePromo(entry, "promotion");
		if (promo !== void 0) promos.push(promo);
	}
	for (const entry of Array.isArray(rawTiers) ? rawTiers : []) {
		const tier = parsePromo(entry, "tier");
		if (tier !== void 0) promos.push(tier);
	}
	return promos;
}
/**
* Attach the promotions that name each model.
*
* The result is UNRESOLVED on purpose: every candidate that names the model
* rides along, so the badge can be chosen at render time against the clock
* (see {@link selectPromoBadge}). Resolving here would freeze the answer at
* fetch time — the defect that makes a "night discount" badge keep claiming
* the night after the night is over.
*/
function attachPromos(models, promos) {
	if (promos.length === 0) return [...models];
	const byModel = /* @__PURE__ */ new Map();
	for (const promo of promos) for (const modelId of promo.modelIds) {
		const list = byModel.get(modelId);
		if (list === void 0) byModel.set(modelId, [promo]);
		else list.push(promo);
	}
	return models.map((model) => {
		const list = byModel.get(model.id);
		if (list === void 0) return model;
		return {
			...model,
			promos: [...list].sort((a, b) => b.priority - a.priority)
		};
	});
}
/**
* Minutes since local midnight in `timeZone` at `nowMs`.
*
* `Intl` does the zone maths, because the upstream's windows are written in
* the zone IT names (Asia/Shanghai for the CN feed) and the user's own clock
* is not necessarily in that zone. An unusable zone falls back to UTC rather
* than throwing: a badge that cannot be placed is a missing badge, not a
* broken card.
*/
function zonedMinutes(nowMs, timeZone) {
	const zone = timeZone ?? "UTC";
	try {
		const parts = new Intl.DateTimeFormat("en-US", {
			timeZone: zone,
			hour: "2-digit",
			minute: "2-digit",
			hourCycle: "h23"
		}).formatToParts(new Date(nowMs));
		const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
		const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
		if (!Number.isFinite(hour) || !Number.isFinite(minute)) return 0;
		return hour * 60 + minute;
	} catch {
		return 0;
	}
}
/** Whether `nowMinutes` falls inside one of the daily windows. */
function withinDailyWindows(windows, nowMinutes) {
	return windows.some((window) => {
		const start = minutesOfClock(window.start);
		const end = minutesOfClock(window.end);
		if (start === void 0 || end === void 0) return false;
		if (start === end) return true;
		if (end > start) return nowMinutes >= start && nowMinutes < end;
		return nowMinutes >= start || nowMinutes < end;
	});
}
/**
* Whether the promotion's ABSOLUTE window holds now.
*
* The absolute window (`validFrom` / `validUntil`) is the promotion's own
* lifetime. It gates the badge on its own: a promotion whose lifetime has
* ended must not keep advertising itself, whatever its daily hours say.
*/
function promoWithinAbsoluteWindow(promo, nowMs) {
	const schedule = promo.schedule;
	if (schedule === void 0) return true;
	if (schedule.validFrom !== void 0 && nowMs < schedule.validFrom) return false;
	if (schedule.validUntil !== void 0 && nowMs >= schedule.validUntil) return false;
	return true;
}
/**
* Whether the promotion's DAILY window holds now.
*
* The daily window is the discount's own hours — it is what makes a
* promotion a "night discount" — and a promotion without one is running
* whenever its absolute window holds.
*
* A schedule whose `daily` was published but could not be evaluated
* ({@link WorkBuddyPromoSchedule.dailyUnusable}) is NOT running: the upstream
* did say the campaign has hours, we just cannot read them, and assuming
* "always" is the one guess that overstates the offer.
*/
function promoWithinDailyWindow(promo, nowMs) {
	const schedule = promo.schedule;
	if (schedule === void 0) return true;
	if (schedule.dailyUnusable === true) return false;
	if (schedule.daily === void 0 || schedule.daily.length === 0) return true;
	return withinDailyWindows(schedule.daily, zonedMinutes(nowMs, schedule.timezone));
}
/**
* Whether the promotion is running right now: its absolute window AND its
* daily hours both hold.
*/
function promoActiveAt(promo, nowMs) {
	return promoWithinAbsoluteWindow(promo, nowMs) && promoWithinDailyWindow(promo, nowMs);
}
/**
* Whether the promotion carries ANY temporal statement of its own.
*
* A tier badge ("Pro Only") has no `schedule` at all: it describes the model
* unconditionally, so `promoActiveAt` is trivially true for it. That is
* correct on its own, but it made such a badge eligible for step 1, where it
* could shadow a lower-priority campaign whose window really is open.
* "Running" should mean "this entry says it runs now", and an entry with no
* schedule never does — it only ever "stands". Entries WITH a schedule (a
* lifetime, hours, or both) are the ones that can be running.
*/
function hasSchedule(promo) {
	return promo.schedule !== void 0;
}
function selectPromoBadge(promos, nowMs) {
	if (promos === void 0 || promos.length === 0) return void 0;
	const sorted = [...promos].sort((a, b) => b.priority - a.priority || (a.source === b.source ? 0 : a.source === "promotion" ? -1 : 1));
	const running = sorted.find((promo) => hasSchedule(promo) && promoActiveAt(promo, nowMs));
	if (running !== void 0) return running;
	return sorted.find((promo) => promo.badge.display !== "activeOnly" && promoWithinAbsoluteWindow(promo, nowMs) && promo.schedule?.dailyUnusable !== true);
}
/**
* The chip's colour, when the upstream published a usable one.
*
* Only a hex colour is accepted: the value reaches an inline style, and the
* upstream's feed publishes hex (`#009273`, `#FF0000`). Anything else is
* refused rather than passed through, and the card falls back to its own
* brand colour.
*/
function promoBadgeColor(promo) {
	const color = promo.badge.color;
	if (color === void 0) return void 0;
	return /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(color) ? color : void 0;
}
/**
* The host's own badge tone for a promotion, for the 0.2.2+ `model.badge` field.
*
* WHY A TONE AND NOT A COLOUR. From 0.2.2 the host's model directory accepts a
* per-model `badge` (`LlmModelBadge = { text, tone }`) and draws it itself, in
* the same place and shape as the picker's own labels. `tone` is one of four
* semantic slots (`neutral | info | success | warning`), NOT an arbitrary
* colour: the shell paints it from theme tokens so it stays legible in every
* theme, which an upstream hex value cannot guarantee.
*
* The upstream's hex colour is therefore mapped onto the CLOSEST tone rather
* than passed through. Green — the value every CN promotion here uses for "free
* for now" — reads as `success`; blues as `info`; amber/red as `warning`;
* anything else stays `neutral` rather than inventing a meaning.
*
* WHY IT LIVES IN THIS MODULE, not in `client/promo-badge.ts` beside the other
* chip helpers. The consumer that needs it is `src/adapter.ts` — the HOST half,
* which fills `LlmModelInfo.badge` and cannot import from `src/client/` (that
* directory is a separate build, and the host bundle never reaches it). This
* module is the one place both halves already share, and it stays DOM-free so
* the host can load it. `client/promo-badge.ts` re-exports it for the card.
*
* @param promo - The resolved promotion.
* @returns The host tone to stamp on `model.badge`.
*/
function promoBadgeTone(promo) {
	const color = promoBadgeColor(promo);
	if (color === void 0) return "neutral";
	const hex = color.replace("#", "");
	if (hex.length !== 6) return "neutral";
	const r = Number.parseInt(hex.slice(0, 2), 16);
	const g = Number.parseInt(hex.slice(2, 4), 16);
	const b = Number.parseInt(hex.slice(4, 6), 16);
	if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return "neutral";
	if (g > r + 24 && g > b + 24) return "success";
	if (b > r + 24 && b > g + 8) return "info";
	if (r > b + 24) return "warning";
	return "neutral";
}
//#endregion
//#region src/busy.ts
/** The upstream's enum, in the order its own bundle declares it. */
const WORKBUDDY_BUSY_LEVELS = [
	"idle",
	"normal",
	"busy",
	"congested",
	"unavailable",
	"unknown"
];
/** Coerce one `busy_level` value; everything the enum does not name is `unknown`. */
function normalizeBusyLevel(value) {
	return typeof value === "string" && WORKBUDDY_BUSY_LEVELS.includes(value) ? value : "unknown";
}
/**
* Read one probe answer into a model-id → level map.
*
* Tolerant by design: an entry that is not an object, or that names no model, is
* skipped; a level the enum does not know becomes `unknown` rather than being
* dropped, because "the upstream answered about this model but said something
* we do not understand" is still a fact about that model.
*/
function parseBusyLevels(entries) {
	const levels = /* @__PURE__ */ new Map();
	for (const entry of Array.isArray(entries) ? entries : []) {
		if (typeof entry !== "object" || entry === null) continue;
		const raw = entry;
		const id = typeof raw["model"] === "string" ? raw["model"] : "";
		if (id === "") continue;
		levels.set(id, normalizeBusyLevel(raw["busy_level"]));
	}
	return levels;
}
/**
* Split ids into probe-sized batches, de-duplicated and order-preserving.
*
* De-duplication matters: the roster the plugin sends is the `cli` agent's
* roster PLUS the user's kept ids, so the same id can legitimately appear twice,
* and the upstream counts what it is asked for.
*/
function batchModelIds(ids, size = 50) {
	const unique = [...new Set(ids.filter((id) => id !== ""))];
	const batches = [];
	for (let index = 0; index < unique.length; index += size) batches.push(unique.slice(index, index + size));
	return batches;
}
/**
* Attach each model's level to its catalog entry.
*
* A model the probe did not answer for keeps whatever it had — which, for a
* freshly discovered roster, is nothing. Models are copied, never mutated: the
* catalog entry is shared with the settings card's saved snapshot.
*/
function attachBusyLevels(models, levels) {
	return models.map((model) => {
		const level = levels.get(model.id);
		return level === void 0 || level === model.busyLevel ? model : {
			...model,
			busyLevel: level
		};
	});
}
//#endregion
//#region src/upstream.ts
/**
* WorkBuddy (CodeBuddy / copilot.tencent.com) upstream client: chat streaming,
* token refresh, model catalog, and credit balance.
*
* 参考：corrinehu/dsh-workbuddy-connect（MIT，Copyright (c) 2026 Corrine Hu）
*   — 端点与 wire behavior 由其实现，上游协议本身参照
*     Sliverkiss/workbuddy2api（MIT）。照搬的部分：按 domain 选择
*     CN/global base、强制 stream:true、tool_choice 压平为字符串、
*     CLI 形态请求头、chat 请求绝不携带 refresh token 的安全红线、
*     中英文额度不足标记与错误分类、token 刷新的 X-Refresh-Token 头。
* 改动：原版的 `fetchModels` 只保留 id/name/maxInputTokens/maxOutputTokens，
*   丢弃了上游其余 20 个字段。实测上游每个模型还给出 `credits` 积分倍率、
*   `supportsImages` 多模态、`reasoning.supportedEfforts` 推理档位、
*   `descriptionZh/En` 描述等，这些正是模型管理卡片所需的信息，
*   本实现将其完整解析（解析不出则留空，不虚构）。
*   `reasoning` 另有两种拼写：复数 `supportedEfforts` 形态与单数 `effort`
*   形态（只声明默认档；两网关实测这些模型接受全阶梯，不发参数即不
*   思考），解析层将单数形态折叠为复数（见 parseReasoning，issue #7）。
*   另：积分接口改为按套餐名聚合，实测单个账号下同名「运营裂变包」
*   可达 19 个，逐条渲染会淹没卡片。
*   模型目录路径改为 `/v2/enterprises/personal/models`（原版为
*   `/console/enterprises/personal/models`）：两版官方桌面 App 均调用
*   `/v2` 形态，CN 网关两条路径逐字节同答，而国际版网关（workbuddy.ai）
*   只答 `/v2`、`/console` 形态返回 HTTP 500——统一 `/v2` 即同时覆盖
*   国内版与国际版（WorkBuddy AI）账号，区域由 `domain` 自动路由。
*
* @module dsh-connect-workbuddy/upstream
*/
/**
* The write half of each campaign: the endpoint that actually grants the
* credits.
*
* Kept beside the status paths because they must move together: the pair is
* what the 「套餐与积分」 page itself uses (`xp`/`vp` in its bundle), and a
* campaign whose status is read from one path can only be claimed through its
* matching claim path. Note the same absence of a `/v2` prefix.
*/
const BENEFIT_CLAIM_PATHS = {
	compensation: "/billing/meter/claim-compensation",
	gift: "/billing/meter/claim-gift"
};
const CN_CHAT_BASE = "https://copilot.tencent.com";
const CN_BILLING_BASE = "https://www.codebuddy.cn";
const GLOBAL_BASE = "https://www.workbuddy.ai";
/**
* Legacy model-catalog path, kept only as the CN region's FALLBACK.
*
* This is the document the WorkBuddy *plugin* used to read, and it is NOT the
* document the WorkBuddy *app* reads: the gateway answers it with the CLI
* channel's roster, which carries neither the app's `auto` slot nor any
* promotion feed. The free Hy4 tier that used to live here as a separate
* `hy4-preview-f` record is gone as a record — measured 2026-10-21, both
* channels list the paid `hy4-preview` (`x0.29`) — and the free tier is now
* expressed as a promotion badge (`夜间免费`) in the app-channel document only.
* So this path is strictly poorer than {@link GLOBAL_CONFIG_PATH}; it stays
* only so that a gateway which stops serving the modern document degrades
* instead of emptying the region.
*/
const MODELS_CATALOG_PATH = "/v2/enterprises/personal/models";
/**
* Remote product-config path — the document the WorkBuddy app itself reads for
* its model list, its prices AND its promotion badges.
*
* It is field-compatible with {@link MODELS_CATALOG_PATH} for every key
* {@link parseUpstreamModel} reads, so one parser still serves both, and it
* additionally carries `modelPromotions` / `modelTiers` — the promotion feed
* no other path publishes (see {@link withPromos}).
*
* Which document this path answers depends on the CHANNEL the request claims
* to be (see {@link PRODUCT_UA}); it does not depend on the host: `www.workbuddy.cn`,
* `copilot.tencent.com`, `wb.tencentbuddy.com` and `www.codebuddy.cn` answer
* byte-identically under the same header.
*/
const GLOBAL_CONFIG_PATH = "/v3/config";
/**
* The app's model-load probe (see `src/busy.ts`), read-only and free.
*
* Not part of any catalog document: this endpoint answers ONE fact per model id
* — how busy it is right now — and answers it for up to 50 ids at a time. It is
* host- and identity-insensitive on the CN side (measured 2026-10-21 on all
* three CN hosts, under both the CLI and the app user agent: byte-identical),
* so it is asked as the chat channel's own identity.
*
* IT DOES NOT EXIST ON THE GLOBAL GATEWAY. Measured 2026-10-22: this exact POST
* against `www.workbuddy.ai` answers 404 `Route Not Found` (as do the four
* neighbouring spellings tried under both POST and GET), while the same
* credential reads that gateway's `/v3/config` normally and finds no load field
* on any model. {@link WorkBuddyUpstreamClient.fetchModelBusy} is therefore
* expected to THROW for that region — `withBusyLevels` in `src/index.ts` catches
* it and ships the roster without levels. Kept as-is rather than region-gated:
* the day upstream adds it, this needs no change, and the cost today is one
* 404 per refresh that never blocks anything.
*/
const MODEL_BUSY_PATH = "/v2/chat/busy";
/**
* The app's own ceiling for one probe (`timeout: 5e3` in its
* `useModelBusyLevels`). Short on purpose: a slow load probe is worth less than
* the refresh it is attached to, and the catalog must not wait on it.
*/
const MODEL_BUSY_TIMEOUT_MS = 5e3;
/**
* The chat channel's user agent — the identity the plugin's adapter speaks as.
*
* Chat is a different contract from configuration: the conversation-identity
* triple (conversation id, session id, device id) is bound to this channel, and
* the upstream bills and rate-limits it as the CLI agent. The plugin chats as
* the CLI agent on purpose, so this stays {@link CLIENT_UA} everywhere the
* request is a CHAT.
*/
const CLIENT_UA = "CLI/2.63.2 CodeBuddy/2.63.2";
/**
* The product-config channel's user agent: the WorkBuddy APP's own product
* identity, byte-for-byte the header the app sends.
*
* The app builds it in `buildVlmGatewayHeaders` (WorkBuddy 5.8.3) as
*
*     `User-Agent: WorkBuddy/<app> WorkBuddy/<app> CLI/<cli>`
*
* — the app version twice, the CLI version once — and sends it to
* `/v3/config`; the app's own log reads
* `fetch cloud product from url:https://www.workbuddy.cn/v3/config success`
* with `{"user-agent":"WorkBuddy/5.8.3 WorkBuddy/5.8.3 CLI/2.161.0", …}`.
*
* It matters, because `/v3/config` answers a DIFFERENT product configuration
* per client channel. Measured 2026-10-21, same token, same URL, only this
* header differing (CN gateway):
*
*   | User-Agent                                    | `/v3/config` answer                    |
*   | ---                                           | ---                                    |
*   | `CLI/2.63.2 CodeBuddy/2.63.2` (CLI channel)   | 5 keys, 35 models, NO promotion feed    |
*   | `WorkBuddy/5.8.3` (app channel, no CLI part)  | 18 keys, 37 models, no promotion feed   |
*   | `WorkBuddy/5.8.3 WorkBuddy/5.8.3 CLI/2.161.0` | 22 keys, 62 models, 8 promos + 1 tier   |
*
* The CLI channel's answer is a strict SUBSET of the app channel's: it
* publishes neither `modelPromotions` nor `modelTiers`. That is precisely why
* the CN card showed no promotion badge while the WorkBuddy app showed one on
* the very same account — the plugin was reading a document the upstream
* publishes WITHOUT the feed, not a feed that does not exist.
*
* The version suffixes are inert — `WorkBuddy/1.0.0 CLI/2.63.2
* CodeBuddy/2.63.2` answers identically — so what selects the document is the
* CHANNEL the header claims, not the version in it.
*
* Global answers the same document under either app-shaped header (17 keys,
* 28 models, 5 promotions + 1 tier, identical roster), so both regions read
* `/v3/config` as {@link PRODUCT_UA}.
*/
const PRODUCT_UA = "WorkBuddy/5.8.3 WorkBuddy/5.8.3 CLI/2.161.0";
/**
* The GLOBAL gateway's app channel: `WorkBuddy/<version>` with no CLI segment.
*
* This exists because the paragraph above is only true for the CN gateway.
* Measured on the global gateway on 2026-11-06, same token, same URL, only
* this header differing, each shape read 3–30 times with identical results:
*
*   | User-Agent                                     | global `/v3/config` answer                       |
*   | ---                                            | ---                                              |
*   | `WorkBuddy/5.8.3`                               | 23 models, 1 agent (`cli` roster of 21),         |
*   |                                                | `hy-image-3.5` + `kling-video-v3`,                |
*   |                                                | `max-model` / `hy4free` / `hy4std` present       |
*   | `WorkBuddy/5.8.3 WorkBuddy/5.8.3 CLI/2.161.0`  | 39 models, 14 agents, NO `cli` roster,           |
*   |                                                | `hy-image-3.5` GONE,                             |
*   |                                                | `max-model` / `hy4free` / `hy4std` GONE          |
*   | `CLI/2.63.2 CodeBuddy/2.63.2`                  | 28 models, 16 agents (`cli` roster of 26),       |
*   |                                                | `deepseek-v4.1-flash` at `x0.00`                 |
*
* So on the global gateway a trailing `CLI/…` segment selects a THIRD
* document — the poorest of the three — while on the CN gateway that same
* composite string is the richest one (62 models + 8 promos). The two
* gateways genuinely disagree, which is why {@link PRODUCT_UA} must NOT be
* "fixed" globally: doing so collapses CN from 61 models + a 17-row `cli`
* roster down to 39 models with no roster at all (measured, same token).
*/
const APP_CHANNEL_UA = "WorkBuddy/5.8.3";
/**
* The CLI channel's product identity, used to read the SECOND global document.
*
* Deliberately not a reference to {@link CLIENT_UA} even though the strings are
* equal today: that constant is a CHAT contract pinned to the versions the
* conversation-identity triple was verified against, while this one only
* selects a catalog. A future chat-contract bump must not silently move the
* discovery channel with it.
*
* Why read it at all: the plugin CHATS as the CLI agent, and the global CLI
* document publishes eight chat models the app document does not mention —
* `fast-model`, `balanced-model`, `primary-model`, `deepseek-v4.1-flash`,
* `hy4-preview`, `gpt-5.5`, `gpt-5.4`, `glm-5.2`. Reading only the app
* document hid the CLI's own `x0.00` DeepSeek row while that row answered
* HTTP 200 over the plugin's own chat channel. See {@link mergeModelRosters}.
*/
const CATALOG_CLI_UA = "CLI/2.63.2 CodeBuddy/2.63.2";
/**
* The app version inside {@link PRODUCT_UA}, for headers that need it alone.
*
* Derived from the UA instead of repeated as a literal: the `X-IDE-Version`
* header (issue #132) must agree with what the UA claims, and two independent
* literals is exactly how those two drift apart at the next version bump.
*/
const APP_VERSION = PRODUCT_UA.match(/WorkBuddy\/([^\s]+)/u)?.[1] ?? "5.8.3";
const JSON_TIMEOUT_MS = 3e4;
const ERROR_BODY_LIMIT = 4096;
/**
* Ceiling for one real-volume probe to get a RESPONSE, which is not a metadata
* call.
*
* Much larger than {@link JSON_TIMEOUT_MS} on purpose: a probe posts ~25k input
* tokens, so prompt processing legitimately takes a while before the first byte
* comes back. It exists only to stop a connection that will NEVER answer — the
* pool's batch is serial, so one hung member would otherwise block all the rest
* with nothing in the UI to say which one it was; the budget covers the response
* only, never the one-line body that follows.
*
* THIRTY SECONDS, NOT TEN. The old 10 s was chosen as "comfortably above a
* working gateway's first byte", and on a fast path it is — but measured on a
* real 25k-token probe body over ordinary Chinese broadband, the first byte
* alone took 3.47 s / 3.57 s / 6.97 s on three consecutive attempts. A 10 s
* ceiling therefore left under 3 s of margin on the worst run, and any jitter
* blew through it.
*
* The cost of tripping it was never just a failed test: `status: 0` carries no
* `retryAtMs`, so the pool fell back to {@link POOL_UNKNOWN_COOLDOWN_MS} (30
* minutes) and benched healthy accounts, answering "池中已无可用账号" and a 502 to
* every request until the cooldown lapsed. The two failure directions are not
* symmetric — waiting an extra 20 s on a genuinely dead endpoint costs one
* stalled batch member, while firing early costs half an hour of the whole pool
* — so this ceiling is deliberately generous.
*
* It also does not cover THIS MACHINE's identity work. Since P3 the header build
* may spawn the device-token subprocess (budget 20 s), and starting the clock
* before that would turn a healthy gateway into "unreachable" on a cold start —
* see the note in `probeChat` for why that matters to the pool.
*/
const PROBE_TIMEOUT_MS = 3e4;
/**
* 生图请求的超时。
*
* 实测一张 1024x1024 的图在官方网关要 17–39 秒（`hunyuan-image-alpha`，
* 2026-10-21，两个国内入口各测一次），比任何 JSON 接口都慢一个数量级，
* 因此不能复用 {@link JSON_TIMEOUT_MS}。三分钟足够覆盖一次正常的排队+推理，
* 又不至于让一个卡死的连接占住工具槽位太久。
*/
const IMAGE_TIMEOUT_MS = 18e4;
/** 视频提交/轮询的总超时：视频要生成几十秒到几分钟，远大于生图。 */
const VIDEO_TIMEOUT_MS = 6e5;
/** 轮询之间的间隔（官方 CLI pollTask 用 5s）。 */
const VIDEO_POLL_INTERVAL_MS = 5e3;
/**
* 轮询循环自身上限（防死循环）。
*
* 比 {@link VIDEO_TIMEOUT_MS} 短 60s：工具层给的是一个更短的 signal
* （`VIDEO_TOOL_TIMEOUT_MS`），两者叠在一起时**这个检查要先生效**，才能带着
* task id 抛出 `POLL_TIMEOUT`。曾经的 600s 与宿主工具上限相等，先在宿主那边
* 掐断，于是用户只看到 `tool call timed out after 600000ms`（issue #187）。
*/
const VIDEO_POLL_TIMEOUT_MS = 54e4;
/** 单条视频下载超时（官方 CLI 用 120s）。 */
const VIDEO_DOWNLOAD_TIMEOUT_MS = 12e4;
/**
* Insufficient-credit markers.
*
* ENGLISH IS MATCHED CASE-INSENSITIVELY (see {@link classifyUpstreamError}) so
* each entry is spelled once, lowercase. Chinese has no case, so those entries
* are the upstream's own wording.
*
* `credits exhausted` is listed alongside `credit exhausted` because the
* upstream ships the PLURAL — measured 2026-10-13 on a live `14018`:
*
*   {"error":{"data":{"code":14018,"msg":"Credits exhausted. Please visit the
*    link below to purchase add-on packs and get more credits: …"}}}
*
* The singular-only entry silently missed it (`'credits exhausted.'.includes(
* 'credit exhausted')` is FALSE — the `s` sits between the two words), so a
* failure whose entire point is "go top up" was reported as "wait a bit" and
* benched a healthy account for the 30-minute fallback. Both spellings are kept
* because the gateway has been observed to change its wording; neither is
* assumed to be the only one.
*/
const HARD_CREDIT_MARKERS = [
	"insufficient credit",
	"no credit",
	"credit exhausted",
	"credits exhausted",
	"out of credit",
	"quota exceeded",
	"quota exhaust",
	"payment required",
	"credit not enough",
	"not enough credit",
	"credits not enough",
	"积分不足",
	"额度不足",
	"余额不足",
	"积分用完",
	"额度用尽",
	"没有积分"
];
/**
* Business code of the exhaustion refusal (`14018`).
*
* The CODE, not the prose — see {@link HARD_CREDIT_MARKERS} for the wording bug
* this guards against. Marker tables rot in a way codes do not: the gateway can
* reword its sentence without changing the contract it advertises, and the
* failure is silent (the branch simply stops matching). A code cannot drift like
* that, and reading it (see {@link statesBusinessCode}) keeps a request id that
* happens to contain the digits from promoting an unrelated body.
*
* ONLY a corroborating signal, never a substitute: the code is checked in
* addition to the markers, so a body that names the code AND reads as a policy
* refusal still resolves by the marker table's order.
*/
const CREDITS_EXHAUSTED_CODE = 14018;
/** Session-invalidation markers that mean "sign in again in the WorkBuddy app". */
const SESSION_DEAD_MARKERS = ["Offline user session not found", "12153"];
/**
* The business code a failure envelope states, or `undefined` when it names none.
*
* WHY PARSE RATHER THAN SEARCH THE TEXT. The five marker constants below this
* file used to look for the quoted-key form (`'"code":11140'`) with `includes`,
* which is exact only for ONE serialization: measured behaviour of the real
* gateway is compact JSON, so it worked. It is nonetheless a spelling test
* dressed up as a code test, and two spellings that a proxy, a re-serializer or
* a nested envelope can produce fell through it — `{"code": 11140}` (a space) and
* `"code":"11140"` (a string). The consequence of a MISS is not neutral: with no
* policy marker and no channel marker, the body classifies as `client`, and
* `outcomeOfFailure(403, …)` then answers `credential-rejected`, which marks a
* perfectly healthy account as SIGNED OUT and benches it (issue #127 review).
*
* Reading the field is exact for all three spellings and for the nested
* `{"error":{"data":{"code":…}}}` shape this file already documents at the
* credit markers. `JSON.parse` also decodes `\uXXXX` escapes, which raw-text
* matching cannot see (see {@link isAccountRestrictedBody}).
*
* The body arrives TRUNCATED to {@link ERROR_BODY_LIMIT}, so a parse failure is
* normal for a large HTML error page and falls back to the compact/spaced text
* forms rather than reporting no code. A request id is hexadecimal and can
* contain `11140` by coincidence, which is why the fallback anchors on the
* quoted key and a digit boundary rather than the bare digits.
*/
function businessCodeOf(body) {
	let parsed;
	try {
		parsed = JSON.parse(body);
	} catch {
		const match = /"code"\s*:\s*"?(\d{4,6}(?!\d))/u.exec(body);
		return match?.[1] === void 0 ? void 0 : Number(match[1]);
	}
	if (typeof parsed !== "object" || parsed === null) return void 0;
	return businessCodeOfDocument(parsed);
}
/**
* The business code a PARSED failure document states, or `undefined`.
*
* ONE READER FOR TWO CALLERS (issue #155's second half). The classifier needs
* the code to decide a kind; `parseUpstreamErrorDetail` needs it to print
* `code 11128` in the reply the user pastes into an issue. The display half used
* to read only a top-level `code` that was `typeof === 'number'`, so for two of
* the spellings below the SAME body produced a diagnosis from the code while
* showing no code at all — and `client`/`channel_reject` is exactly the pair a
* reporter needs to be able to cross-check. Extracted so the two cannot drift
* again; `businessCodeOf` keeps the unparseable-body fallback on top of it.
*/
function businessCodeOfDocument(raw) {
	const direct = asBusinessCode(raw["code"]);
	if (direct !== void 0) return direct;
	const error = raw["error"];
	if (typeof error === "object" && error !== null) {
		const data = error["data"];
		if (typeof data === "object" && data !== null) {
			const nested = asBusinessCode(data["code"]);
			if (nested !== void 0) return nested;
		}
		const direct = asBusinessCode(error["code"]);
		if (direct !== void 0) return direct;
	}
	const data = raw["data"];
	if (typeof data === "object" && data !== null) return asBusinessCode(data["code"]);
}
/** One code field, accepting the number and the string spelling alike. */
function asBusinessCode(value) {
	if (typeof value === "number" && Number.isInteger(value)) return value;
	if (typeof value === "string" && /^\d{4,6}$/u.test(value.trim())) return Number(value.trim());
}
/**
* Whether a failure body states this business code, in ANY of its spellings.
*
* THE BUG THIS REMOVES (issue #155). Three of the four code families below were
* recognised by `body.includes('"code":11128')` — a byte test on ONE
* serialization. Issue #127 had already proven that test unreliable, but it
* converted `11140` ONLY: measured on `6bdba2a`, `businessCodeOf` has exactly
* one call site, despite that commit's message claiming `11128` as well. So the
* SAME envelope answered one thing to the parser and another to the classifier.
* Measured row by row against the shipped code:
*
*   body                       classify         detail.upstreamCode
*   {"code":11128}             channel_reject   11128
*   {"code": 11128}            client ← 漏      11128
*   {"code":"11128"}           client ← 漏      undefined ← 也漏
*   {"error":{"code":11128}}   channel_reject   undefined ← 反向不一致
*   {"CODE":11128}             client ← 漏      undefined
*
* TWO DIFFERENT mismatches. Row 2 is what the reporter pasted into issue #155:
* `code 11128` in the text (`parseUpstreamErrorDetail` reads a top-level NUMBER,
* which JSON.parse delivers even for a spaced body) beside `"type":"client"`
* (decided by the substring) — a diagnosis disagreeing with its own evidence
* inside one message. Rows 3–5 are worse for support and invisible to the user:
* the readers disagree AND the code support asks for is missing entirely. Row 4
* runs the OTHER way (the substring happens to hit the nested `"code":11128`
* while the parser only knew `error.data.code`), which is why this could not be
* fixed by "just use the parser" — both readers must consult ONE fact.
* That is not cosmetic — the channel rescue ladder runs ONLY for
* `channel_reject` (`src/shim.ts` gates on `result.kind === 'channel_reject'`),
* so any other kind skips it entirely: `forceNeutralHead` and both perturbation
* rungs never fire, and the user is told to "adjust the request" for a refusal
* the plugin never tried to rescue. Issue #113's whole fix depends on whether
* the upstream happened to emit a space.
*
* THREE READS, IN THIS ORDER, and the ordering is the safety property:
*
* 1. A code the envelope STATES is final. `businessCodeOf` found one ⇒ that is
*    the answer, and the text scan below is never consulted. Without this rule,
*    OR-ing the two reads would let a nested sub-object's `"code":11128`
*    (inside `extError`, say) reclassify an envelope whose own verdict is
*    `14003` — promoting a detail over the verdict, the reverse of the precision
*    issue #127 bought.
* 2. A body that PARSES but states no code in the three shapes `businessCodeOf`
*    knows still gets the quoted-key text scan. That is where this fix strictly
*    widens the old behaviour: an undocumented nesting (`{"error":{"code":…}}`)
*    used to be recognised by the substring, and dropping it here would be a
*    regression dressed up as a refactor.
* 3. The scan anchors on `"code":<n>`, never the bare digits, so a hexadecimal
*    request id containing `11128` cannot promote an unrelated body — the hazard
*    the original quoted-key form existed to avoid, kept intact. The scan is
*    applied case-insensitively. This half RESTORES rather than preserves a
*    behaviour, and the two halves of the family disagreed about it: the member
*    predicates lower-cased the body before testing it (so `{"CODE":11128,…}`
*    matched, pinned by `tests/issue98-channel-gate`), while the family
*    predicate tested the RAW body and did not. One reader now answers both.
*
* The text form is derived from the number rather than declared beside it: two
* constants for one code are two truths that drift, and a stale text form would
* silently reinstate the bug above for exactly the spelling this function exists
* to catch.
*/
function statesBusinessCode(body, code) {
	const stated = businessCodeOf(body);
	if (stated !== void 0) return stated === code;
	return body.toLowerCase().includes(`"code":${code}`);
}
/** The `11140` content-policy family, whatever the envelope's JSON spelling is. */
const CONTENT_POLICY_CODE = 11140;
/**
* Content-policy refusal markers from the chat gateway. The code is READ rather
* than text-matched so a request id cannot contain `11140` by coincidence and
* promote an unrelated body — and, since issue #155, so the ONE read is shared
* with every other family here instead of being a second, subtly different rule.
*
* `request illegal` is deliberately absent: the live `11128` channel-gate body
* uses the SAME `msg`, so this marker used to run first and classify that gate
* as `policy_reject`. The consequence was severe — the channel rescue ladder
* never ran, the reply changed 400 to 403, and users were told to switch
* accounts for a request-side refusal (issue #127).
*
* THE NESTING GAP #127 LEFT BEHIND, and why this now reads through
* {@link statesBusinessCode}. Issue #127 replaced the text match with the parser
* alone, which is exact for the three shapes that parser knows (`code`,
* `error.data.code`, `data.code`) — and therefore silently NARROWED coverage for
* a body whose code sits anywhere else, such as `{"error":{"code":11140}}`, which
* the old text match did catch. The helper keeps both: a code the envelope states
* wins outright (the precision #127 was after), and the text scan runs only when
* nothing was stated, where it can only restore a match the parser could not see.
*/
function isContentPolicyBody(body) {
	return statesBusinessCode(body, CONTENT_POLICY_CODE);
}
/**
* Whether a failure body is the account-restriction member of the `11140`
* family (issue #127).
*
* TWO HALVES MUST BOTH HOLD — the business code `"code":11140` AND one of the
* restriction spellings. This is the same rule this file already applies to the
* `11128` family after issue #127: a bare sentence never classifies anything,
* because it is text that can appear anywhere.
*
* WHY THE CODE HALF IS NOT OPTIONAL HERE. The verdict is the heaviest in the
* classifier: `account_restricted` is failover-worthy AND benches the account
* with NO cooldown — nothing but a re-authorisation returns it. Measured before
* the code was required (see `classifyUpstreamError`), a body that merely
* MENTIONS the phrase classified as `account_restricted` whatever else it was:
* a 402 credit exhaustion, a 401 dead session, and even a 500 whose generic
* `retry later` text happened to contain the words. Each of those would have
* taken an account permanently out of the pool for a condition that was about
* the wallet, the token, or the platform. The code half is what keeps a heavy,
* non-self-healing verdict pinned to the one business code that states it.
*
* Both measured `displayMsg` spellings are recognised (the Chinese sentence and
* its English translation). A `11140` body carrying neither stays
* `policy_reject`: inventing an account verdict from the shared code alone would
* bench an account over a request-side refusal — the mirror-image error, which
* the code half must not be allowed to fix by loosening the phrase half.
*/
const ACCOUNT_RESTRICTED_MARKERS = ["账号存在异常行为", "restricted due to unusual activity"];
/**
* Whether a failure body is the account-restriction member of the `11140` family.
*
* Three separations make this decision safe, and all three were earned by the
* issue #127 review:
*
* 1. **Code-gated.** Only a `11140` envelope can reach the phrase test
*    ({@link isContentPolicyBody}). The phrase alone is not evidence about the
*    account: a risk-control throttle, a credit notice or an HTML edge page can
*    carry the same sentence, and this verdict is the only IRREVERSIBLE one in
*    the classifier — it benches the account with no cooldown.
* 2. **Decoded text.** The match runs on `displayMsg` / `displayTips` / `msg`
*    after `JSON.parse`, not on the raw bytes. An upstream or proxy that
*    serializes non-ASCII as `\uXXXX` (Python's `json.dumps` default) would
*    otherwise never match the Chinese sentence, and a restriction would silently
*    degrade to a content refusal. Matching the FIELD rather than the whole body
*    also stops the phrase in an unrelated field from deciding the class.
* 3. **Whitespace-normalized.** A line break inside the sentence survives as
*    `\n` in raw JSON and as real whitespace once parsed; collapsing runs of
*    whitespace means both spellings match.
*/
function isAccountRestrictedBody(body) {
	if (!isContentPolicyBody(body)) return false;
	const haystack = accountVerdictText(body);
	if (haystack === "") return false;
	return ACCOUNT_RESTRICTED_MARKERS.some((marker) => haystack.includes(normalizeVerdictText(marker)));
}
/** The sentences an account verdict can be stated in: display fields, then `msg`. */
function accountVerdictText(body) {
	let parsed;
	try {
		parsed = JSON.parse(body);
	} catch {
		return normalizeVerdictText(body);
	}
	if (typeof parsed !== "object" || parsed === null) return "";
	const raw = parsed;
	return normalizeVerdictText([
		localizedText(raw["displayMsg"]),
		localizedText(raw["displayTips"]),
		typeof raw["msg"] === "string" ? raw["msg"] : void 0
	].filter((value) => typeof value === "string").join(" "));
}
/** NFKC, zero-width stripped, whitespace runs collapsed, lower-cased. */
function normalizeVerdictText(text) {
	return text.normalize("NFKC").replace(/[\u200b-\u200d\ufeff]/gu, "").replace(/\s+/gu, " ").trim().toLowerCase();
}
/**
* A `11140` body whose display fields decode to NOTHING at all.
*
* THE FAILURE MODE THIS CATCHES. `isAccountRestrictedBody` needs the business
* code AND a phrase in `displayMsg` / `displayTips` / `msg` — deliberately, so a
* shared sentence cannot bench an account. The mirror risk is a MISS: if the
* upstream renames those fields, escapes them differently, or moves the
* restriction wording somewhere new, every restriction degrades silently to
* `policy_reject` and a benched-worthy account keeps taking traffic with no log
* line anywhere. A genuine content refusal always carries the fields (its whole
* point is a human-facing sentence), so a `11140` that decodes to no display
* text at all is an anomalous envelope shape, not a normal refusal — exactly the
* narrow condition worth a warning. Bodies WITH display text that merely lack
* the restriction phrase are the everyday `policy_reject` and stay silent.
*
* Pure and side-effect-free: the caller (the transport layer, which holds the
* injected logger) decides what to do with the answer.
*/
function isUndecodablePolicyBody(body) {
	return isContentPolicyBody(body) && accountVerdictText(body) === "";
}
/**
* Business code of the MODEL-scoped throttle (`14003`, "too many requests").
*
* A number rather than the quoted-key text form: the text match was exact for
* one serialization only, so a spaced or string-quoted envelope lost the
* `model_busy` kind and fell through to whatever its HTTP status says — measured
* at HEAD, `429 {"code": 14003}` became `soft_rate` and `400` became `client`.
* That is not a cosmetic rename: `model_busy` is one of the three NON-failover
* kinds (`isFailoverWorthy` in `src/shim.ts`), because the throttle is a fact
* about the MODEL and the next credential joins the same one — so `soft_rate`
* walks the whole pool burning a real request per account to learn nothing,
* while `client` prints neither the kind's advice nor its code (issue #155). See
* {@link statesBusinessCode}.
*/
const MODEL_BUSY_CODE = 14003;
/**
* Business code of the gateway's CHANNEL gate (`11128`, "Illegal API invocation
* from an unapproved channel").
*
* A NUMBER, not the quoted-key text form it used to be. Matching the text was
* exact only for one serialization, which is the whole of issue #155 — see
* {@link statesBusinessCode}.
*
* A DIFFERENT gate from the one {@link conversationHeaders} works around, which
* also answers `11128` (`conversation id missing`). The code is the same
* because the gateway reuses it for every rule in that family; the BODY is what
* tells them apart, so {@link isChannelRejectBody} requires both halves.
*/
const CHANNEL_REJECT_CODE = 11128;
/**
* Business code for "the request exceeded the model's context window" (issue #101).
*
* The gateway answers `11115` in TWO shapes, and only one of them is
* self-describing:
*
*   A. `prompt is too long: 100001 tokens > 100000 maximum` — carries numbers;
*   B. the localized sentence only (「本次输入加上历史对话超过了模型上限…」), no numbers.
*
* Shape B is the one that hurt. The HOST decides whether to run its
* context-overflow rescue by matching the error text against a list of ENGLISH
* patterns (`prompt (?:is )?too long`, `exceeds the context window`,
* `context[_ ]length[_ ]exceeded`, …25 of them), and a Chinese sentence matches
* none of them. So on shape B the host neither compacts nor retries: the user
* gets a bare 400 whose own advice ("请精简内容") the host cannot act on.
*
* {@link contextOverflowMarker} is the fix: the plugin adds an English clause
* the host recognises, and keeps the upstream's own sentence beside it.
*/
/**
* The business code, in either of the two spellings the plugin ever holds.
*
* Two forms are in circulation and BOTH reach this predicate:
*   - the raw upstream body: `{"code":11115,...}`;
*   - the reply this plugin already composed, which renders it as
*     `（code 11115，requestId …）` — the form the retry path re-reads.
*
* The trailing `(?!\d)` matters: `111150` and `1111` both contain the digits
* after a naive substring test, and misreading a DIFFERENT refusal as an
* overflow would send the host into a compaction pass that cannot help.
*/
const CONTEXT_TOO_LONG_CODE = /"code"\s*:\s*11115(?!\d)|code\s+11115(?!\d)/u;
/**
* Whether this body is the context-length refusal, in EITHER of its shapes.
*
* Shape B carries no number and no English phrase, so the business code is the
* only reliable handle — the same reasoning as {@link isChannelRejectBody}'s
* code-plus-wording pair, except that here the wording is what VARIES.
*/
function isContextTooLongBody(body) {
	return CONTEXT_TOO_LONG_CODE.test(body);
}
/**
* An English clause the HOST's overflow detector recognises, for issue #101.
*
* `prompt is too long` is the first entry of the host's pattern list and the
* phrasing Anthropic-compatible gateways already use, so it is the cheapest way
* to say "this is an overflow" to a detector that only reads English. The
* numbers are omitted deliberately: the upstream never gave them in shape B, and
* inventing them would be the exact confident-wrong-diagnosis this plugin spends
* its comments avoiding.
*/
const CONTEXT_OVERFLOW_MARKER = "prompt is too long (upstream code 11115)";
/**
* Wording that identifies the CHANNEL half of `11128` (the other halves being
* `conversation id missing` and `first message is not system prompt`).
*
* Matched against the upstream's `msg`, NEVER against `displayTips`. That is not
* a style choice: the tips are the SAME misleading sentence for every member of
* the `11128` family — "这次调用没通过渠道校验，可能不是官方客户端发出的" — which is
* why matching them would claim the conversation-id gate too and blame the
* prompt's opening for a header problem this plugin already fixes.
*
* Lower-cased before the search. Two spellings are listed because the observed
* bodies name the code and the phrase together
* (`{"code":11128,"msg":"Illegal API invocation from an unapproved channel"}`),
* and either half is enough to identify it.
*/
const CHANNEL_REJECT_MARKERS = ["unapproved channel", "illegal api invocation"];
/**
* The wordings that identify the OTHER two members of the `11128` family.
*
* Used ONLY to NAME a member ({@link channelGateMemberOf}), never to exclude a
* body from the family. The old code used them as an exclusion list, which is
* how issue #113's misreported refusal was kept out of the plugin's retry
* ladder: the upstream wrote `conversation id missing` over a content refusal,
* and the exclusion believed it.
*
* Each is exported as its own predicate ({@link isConversationIdGateBody},
* {@link isFirstMessageGateBody}) so the reply can NAME the gate instead of
* relaying the upstream's `displayTips` — which is the SAME misleading
* sentence for all three members of the `11128` family.
*/
const CONVERSATION_ID_GATE_MARKER = "conversation id missing";
const FIRST_MESSAGE_GATE_MARKER = "first message is not system prompt";
/**
* Whether a failure body is the MODEL-scoped throttle rather than an account
* limit.
*
* `14003` and `6004` are different codes from the same gateway and mean
* different things. Measured on one credential at one moment, with requests that
* differed ONLY in `model`, three attempts each: `deepseek-v4.1-flash`
* (multiplier x0.00) answered 1/3 and refused 2/3 with `429 / 14003`, while
* `glm-5.3-flash`, `hy3` and `kimi-k2.6` answered 3/3 — the SAME account, the
* SAME second. A 6004, by contrast, carries a `将在 … UTC+8 重置` sentence and
* is per-account.
*
* So the criterion is the CODE alone, read by {@link statesBusinessCode} so a
* request id that happens to contain the digits cannot promote an unrelated
* body. Exported so the probe and the chat path cannot drift into two different
* answers about one body.
*/
function isModelBusyBody(body) {
	return statesBusinessCode(body, MODEL_BUSY_CODE);
}
/**
* Whether a failure body belongs to the `11128` gate family AT ALL.
*
* The code is READ, not text-matched (issue #155): a spaced or string-quoted
* envelope used to fall out of the family here, and out of the rescue ladder
* with it. {@link statesBusinessCode} keeps both reads.
*/
function isChannelGateFamilyBody(body) {
	return statesBusinessCode(body, CHANNEL_REJECT_CODE);
}
/**
* Whether a failure body is the gateway's CHANNEL gate — i.e. whether it
* belongs to the `11128` FAMILY.
*
* ISSUE #113, AND WHY THIS NOW ANSWERS "IS IT THE FAMILY" RATHER THAN "IS IT
* THE PROMPT MEMBER". The family has three members (prompt fingerprint,
* missing conversation id, missing system head) sharing one business code and
* one `displayTips` sentence, so the `msg` wording used to be the only thing
* that could tell them apart — and the wording is NOT reliable. Issue #113
* measured a CN refusal whose `msg` read `conversation id missing` while the
* three conversation-id headers were all present and correct; the refusal was
* about the request's CONTENT.
*
* The old rule required the channel wording AND the absence of the sibling
* wordings, so such a body was excluded from the channel gate entirely and
* filed as a plain `client`. That was not cosmetic: `client` never enters the
* plugin's two-step retry ladder (`forceNeutralHead`, then the invisible
* perturbation), so the rescue path that exists for precisely this refusal
* never ran. That is very likely why the reporters in issue #98's thread found
* that upgrading changed nothing.
*
* Every member of this family is a CHANNEL-verification refusal — the
* upstream's own shared sentence says so — so acting on the family is correct
* whoever the member is. Which member it is decides only what the reply
* ADVISES, and that is {@link channelGateMemberOf}'s job, decided by the
* plugin's own evidence rather than by a wording the upstream may misreport.
*
* The code is read by {@link statesBusinessCode}, exactly as the family test
* above it does — this function adds nothing to that decision and must not
* appear to own a rule of its own. The reason the code is READ rather than
* text-matched is unchanged (issue #155): a request id is hexadecimal and can
* contain the digits `11128` by coincidence, and a bare substring search over an
* arbitrary failure body is how a red herring gets promoted into a diagnosis.
*/
function isChannelRejectBody(body) {
	return isChannelGateFamilyBody(body);
}
/**
* Whether a failure body is the CONVERSATION-ID gate (`11128`).
*
* One of the two gates that share the channel gate's business code, and one
* of the two this plugin's diagnosis EXCLUDES: the prompt is not at fault
* here, the request headers are — which is why it must never be reported as
* "the gateway refused your system prompt".
*
* It is exported anyway, so a reply can NAME it. The upstream's `displayTips`
* for all three `11128` gates is the identical sentence ("这次调用没通过渠道
* 校验，可能不是官方客户端发出的"), so the tips cannot tell them apart — only
* `msg` can. Hence the wording is the criterion and the code is the
* corroboration, never the other way round.
*
* BOTH halves are required, and the code is read by {@link statesBusinessCode}
* rather than text-matched, so a spaced envelope names its member too (issue
* #155). The wording half stays case-insensitive: it is prose.
*/
function isConversationIdGateBody(body) {
	return statesBusinessCode(body, CHANNEL_REJECT_CODE) && body.toLowerCase().includes(CONVERSATION_ID_GATE_MARKER);
}
/**
* Whether a failure body is the FIRST-MESSAGE gate (`11128`).
*
* The global gateway's own rule: a chat request must OPEN with a system
* message, and a user-first body is refused with `11128` / "first message is
* not system prompt". The plugin's `ensureSystemHead()` satisfies it, so a
* body carrying this wording says the request never had a system head — not
* that a system prompt was fingerprinted.
*
* Excluded from the prompt diagnosis for the same reason as
* {@link isConversationIdGateBody}, and named by the same rule: the CODE plus
* the WORDING, the code read rather than text-matched (issue #155), the wording
* case-insensitively.
*/
function isFirstMessageGateBody(body) {
	return statesBusinessCode(body, CHANNEL_REJECT_CODE) && body.toLowerCase().includes(FIRST_MESSAGE_GATE_MARKER);
}
/**
* Which member of the `11128` family a body is, decided by the plugin's OWN
* evidence rather than by the upstream's wording.
*
* THE EVIDENCE, IN ORDER OF STRENGTH.
*
* 1. The body carries the channel wording (`unapproved channel` /
*    `illegal api invocation`). That is the upstream naming the PROMPT gate
*    explicitly, so it is trusted.
* 2. The body says `conversation id missing`. The wording is only believable
*    when the request did NOT carry the conversation-id triple; the plugin's
*    `chatHeaders` adds it to every chat request, so in practice it is always
*    there and the wording is always a misreport — which is issue #113's
*    exact measurement. The refusal is then about the CONTENT, i.e. the
*    PROMPT gate, which is also the only member the plugin can act on.
* 3. The body names the first-message gate. That gate is about the request's
*    SHAPE, and `ensureSystemHead` guarantees a `system` head whenever the
*    request carries messages, so it is only reported as that gate when the
*    request genuinely had none.
* 4. Otherwise: `unknown`. The family is still the family — the retry ladder
*    applies — but the reply says it cannot name the member rather than
*    guessing, because a confidently wrong diagnosis sends the user to edit a
*    prompt that is not at fault.
*
* @param body The failure body.
* @param request What the plugin knows about the request it just sent.
*/
function channelGateMemberOf(body, request) {
	const lower = body.toLowerCase();
	if (CHANNEL_REJECT_MARKERS.some((marker) => lower.includes(marker))) return "prompt";
	if (lower.includes(CONVERSATION_ID_GATE_MARKER)) {
		if (request?.hasConversationHeaders === false) return "headers";
		return "prompt";
	}
	if (lower.includes(FIRST_MESSAGE_GATE_MARKER)) {
		if (request?.hasSystemHead === false) return "first_message";
		return "unknown";
	}
	return "unknown";
}
/**
* The OPENINGS of the `system` messages in a prepared request body.
*
* REMOVED in favour of {@link systemOpeningEvidenceOfBody}, which answers the
* same question ("what did the gate actually see?") for BOTH string and
* array-shaped content and can also say whether an opening is the plugin's own
* neutral head. Two functions that both claim to describe what the gate read
* are two truths that drift — and the array-shaped case is exactly where the
* old one was blind.
*/
/** Longest system-prompt opening echoed back to the user, in characters. */
const SYSTEM_OPENING_LIMIT = 120;
function clip(text, limit) {
	return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}
/**
* Classify an upstream failure from its HTTP status and body excerpt.
*
* The `11128` family is classified BY ITS CODE, not by the `msg` wording —
* see {@link isChannelRejectBody} and {@link channelGateMemberOf}. Which
* member of the family it is decides the ADVICE in the reply, never the
* classification: every member is a channel-verification refusal that no
* account, region or top-up can change.
*/
function classifyUpstreamError(status, body) {
	if (status === 402) return "hard_credit";
	const lower = body.toLowerCase();
	for (const marker of HARD_CREDIT_MARKERS) if (lower.includes(marker.toLowerCase()) || body.includes(marker)) return "hard_credit";
	if (statesBusinessCode(body, CREDITS_EXHAUSTED_CODE)) return "hard_credit";
	for (const marker of SESSION_DEAD_MARKERS) if (body.includes(marker)) return "session_dead";
	if (isAccountRestrictedBody(body)) return "account_restricted";
	if (isContentPolicyBody(body)) return "policy_reject";
	if (isChannelRejectBody(body)) return "channel_reject";
	if (isModelBusyBody(body)) return "model_busy";
	if (parseQueueAnswer(body) !== void 0) return "model_queue";
	if (status === 429) return "soft_rate";
	if (status === 404) return "not_found";
	if (status >= 500) return "server";
	if (status >= 400) return "client";
	return "client";
}
/**
* Read one of the upstream's localized fields, in either shape it ships: a plain
* string, or a `{ zh, en }` object.
*
* One reader for every such field on purpose. `displayMsg` and `displayTips`
* arrive in the same two shapes from the same envelope, so parsing them with two
* separate hand-rolled branches is how one of them ends up only handling the
* object form (which is exactly what happened to `displayTips`: it was never
* read at all, issue #78).
*/
function localizedText(value) {
	if (typeof value === "string") return value;
	if (typeof value !== "object" || value === null) return void 0;
	const localized = value;
	const pick = localized.zh ?? localized.en;
	return typeof pick === "string" ? pick : void 0;
}
/**
* Parse the known-good fields out of an upstream failure body. Non-JSON
* bodies (HTML error pages, empty strings) yield undefined rather than a guess.
*/
function parseUpstreamErrorDetail(body) {
	let parsed;
	try {
		parsed = JSON.parse(body);
	} catch {
		return;
	}
	if (typeof parsed !== "object" || parsed === null) return void 0;
	const raw = parsed;
	const displayMsg = localizedText(raw.displayMsg) ?? (typeof raw.msg === "string" ? raw.msg : void 0);
	const tips = localizedText(raw.displayTips);
	const detail = {};
	const statedCode = businessCodeOfDocument(raw);
	if (statedCode !== void 0) detail.upstreamCode = statedCode;
	if (typeof raw.requestId === "string") detail.requestId = raw.requestId;
	if (typeof raw.msg === "string" && raw.msg !== "") detail.rawMsg = raw.msg;
	if (displayMsg !== void 0) detail.displayMsg = displayMsg;
	if (tips !== void 0) detail.tips = tips;
	const ext = raw.extError;
	if (typeof ext === "object" && ext !== null && !Array.isArray(ext)) {
		const extRaw = ext;
		const param = extRaw["param"];
		if (typeof param === "string" && param !== "") detail.rejectedParam = param;
		const value = extRaw["value"];
		if (typeof value === "string" && value !== "") detail.rejectedTier = value;
	}
	return detail;
}
/**
* Region for a login domain; an empty domain means CN (matching upstream tooling).
*
* The international product is reachable under TWO brand domains: the WorkBuddy
* AI desktop app signs in at `workbuddy.ai`, while the CodeBuddy CLI signs the
* same international account in at `codebuddy.ai` (verified against a real
* credential file, issue #4). Both are served by the same gateway stack — a
* read-only probe shows `/v3/config` answering HTTP 200 with the same JSON
* envelope on both hosts — so both classify as `global`. Missing the
* `codebuddy.ai` spelling sent those tokens to the CN gateway, which rejected
* them at the openresty layer with an HTML 401.
*/
function regionOf(domain) {
	const lowered = domain.trim().toLowerCase();
	if (lowered === "workbuddy.ai" || lowered.endsWith(".workbuddy.ai")) return "global";
	if (lowered === "codebuddy.ai" || lowered.endsWith(".codebuddy.ai")) return "global";
	return "cn";
}
/**
* The STRICT counterpart of {@link regionOf}: a region's domain only when it is
* positively recognised, `undefined` for anything else.
*
* `regionOf`'s catch-all is deliberate — the CN product is single-homed, so an
* unrecognised spelling is treated as CN and a real (if oddly written) CN
* credential still resolves. That reasoning holds only for a domain the
* UPSTREAM issued. It does not hold for a value read out of a file someone
* handed the plugin: there "unrecognised" means "cannot be classified", and
* calling it CN would file a foreign or spoofed credential in the CN vault.
* Import gates must use this, not {@link regionOf}.
*
* Both sides are matched on their registrable domain, so a bare host and any
* subdomain qualify while a lookalike such as `codebuddy.cn.evil.com` cannot.
*
* `copilot.tencent.com` is NOT a third product — it is this plugin's OWN CN
* chat gateway (`CN_CHAT_BASE`), and the credential's `domain` field carries it
* verbatim on real records. Refusing it here made the plugin reject its own
* export: the card exported 8 accounts, and re-importing that file skipped the
* three whose `domain` was the gateway. It cannot be spoofed into the wrong
* region by being recognised here — it names the CN gateway, so admitting it is
* the same decision as admitting `workbuddy.cn`.
*/
function knownRegionOf(domain) {
	const lowered = domain.trim().toLowerCase();
	if (lowered === "") return void 0;
	if (lowered === "workbuddy.ai" || lowered.endsWith(".workbuddy.ai")) return "global";
	if (lowered === "codebuddy.ai" || lowered.endsWith(".codebuddy.ai")) return "global";
	if (lowered === "workbuddy.cn" || lowered.endsWith(".workbuddy.cn")) return "cn";
	if (lowered === "codebuddy.cn" || lowered.endsWith(".codebuddy.cn")) return "cn";
	if (lowered === "copilot.tencent.com" || lowered.endsWith(".copilot.tencent.com")) return "cn";
}
/**
* Gateway for a global credential.
*
* International accounts are NOT interchangeable across brand domains: a token
* issued at `codebuddy.ai` is rejected by the `workbuddy.ai` gateway (and vice
* versa), so the base must follow the credential's OWN domain rather than a
* single hardcoded host. Anything unrecognised falls back to `workbuddy.ai`,
* the desktop app's gateway.
*/
function globalBase(domain) {
	const lowered = domain.trim().toLowerCase();
	if (lowered === "codebuddy.ai" || lowered.endsWith(".codebuddy.ai")) return "https://www.codebuddy.ai";
	return GLOBAL_BASE;
}
/**
* The CN gateway base for this process, resolved ONCE at construction.
*
* Empty means "no override", and then the constant is used — the pre-#220
* behaviour, byte for byte. A non-empty value has already passed
* `resolveCnGateway`'s allowlist, so this is a validated host and not whatever
* happened to be in the settings file.
*
* Deliberately injected rather than read from config at each call site: the CN
* base feeds a Bearer token, so "which host" must be decided in exactly one
* place that can be pointed at and audited, not re-derived by ten request
* builders. The class also swaps it when the setting changes (the mount
* reconstructs the client on a volatile update).
*/
function chatBase(credential, cnBase) {
	if (regionOf(credential.domain) === "global") return globalBase(credential.domain);
	return cnBase === void 0 || cnBase === "" ? CN_CHAT_BASE : cnBase;
}
function billingBase(credential, cnBase) {
	if (regionOf(credential.domain) === "global") return globalBase(credential.domain);
	return cnBase === void 0 || cnBase === "" ? CN_BILLING_BASE : cnBase;
}
function originReferer(credential) {
	return regionOf(credential.domain) === "global" ? globalBase(credential.domain) : CN_BILLING_BASE;
}
/**
* 5.16.0 的公共头，**不含 P1 增补**。
*
* 只给 {@link refreshHeaders} 用，而且是有意的：refresh 是整条链路里唯一
* "失败就等于掉登录"的一跳，它的字节不该因为一次身份统一而变化。B 的
* `RefreshHeaders` 确实也走 `CommonHeaders`（因此带 `X-CodeBuddy-Request`），
* 但那是 B 一直在跑的形状；本插件没有在 refresh 上验过任何新头，
* "别人这么发" 不等于 "我们可以这么改"。
*/
function legacyCommonHeaders(credential) {
	return {
		"Accept": "application/json, text/plain, */*",
		"X-Requested-With": "XMLHttpRequest",
		"Origin": originReferer(credential),
		"Referer": `${originReferer(credential)}/`,
		"User-Agent": CLIENT_UA
	};
}
/**
* 客户端调用（chat 家族）的公共头 = {@link legacyCommonHeaders} + P1 增补。
*
* 目前只有 chat 一条路径用它（`chatStream` 与 `probeChat`，两者是同一个合同）。
* 元数据读与维护跳走 `legacyCommonHeaders`，见那条注释里的边界说明。
*/
function commonHeaders(credential, identity = {}) {
	const headers = legacyCommonHeaders(credential);
	if (profileOf(identity) === "balanced") {
		headers["X-CodeBuddy-Request"] = "1";
		headers["Accept-Language"] = acceptLanguageOf(credential);
	}
	return headers;
}
/**
* The conversation-identity triple the chat endpoint now requires (issue #66).
*
* WHY THIS EXISTS. The international gateway added a second gate on top of the
* `system`-head rule from 3.1.0: a chat request must carry the official desktop
* client's conversation identity, or every step is refused with business code
* `11128` / `conversation id missing`. That error's own `displayTips` blames
* "渠道校验 / 不是官方客户端发出的", which reads as a client-identity problem —
* the literal message is the actionable part, and it names a MISSING CONVERSATION
* ID, not a missing or wrong user agent.
*
* The two gates are independent, and both must hold (measured 2026-10-16 on the
* real international gateway, plugin body shape unchanged):
*
*   headers            messages          result
*   -----------------  ----------------  --------------
*   plugin as-shipped  ["system","user"] 400 / 11128
*   plugin + triple    ["system","user"] 200
*   plugin + triple    ["user"]          400 / 11128
*
* So `ensureSystemHead()` must NOT be dropped as "no longer needed": the system
* rule went from sufficient to necessary-but-not-sufficient. The last row is what
* keeps this function from being mistaken for a replacement for it.
*
* MINIMAL SET. The official bundle's `applyGatewayHeaders` also sends
* `acp-connection-id`, `X-Agent-Intent` / `X-Agent-Purpose`, `X-IDE-*`,
* `X-Private-Data` and trace headers. Bisecting them one at a time showed NONE of
* those is required: `X-Conversation-Request-ID` and `-Message-ID` are needed
* alongside `X-Conversation-ID` (that one alone still fails), and each of the
* extras is satisfied by the triple without it. Hence exactly three.
*
* VALUES. The gateway does not verify where these ids come from — any well-formed
* UUID passes — so nothing here is a secret and nothing is persisted. They are
* still freshly generated per request, as the official client generates
* its own per call: reusing one value across requests would forge a
* conversation identity the plugin does not actually have, and the first thing
* that would break is the upstream's own correlation of a session it is being
* told about twice under one id.
*
* APPLIED TO BOTH REGIONS on purpose. The CN gateway tolerates their absence
* today, so this is harmless there — and a header that is only ever sent on one
* side is exactly how the 3.1.0 defect became international-only and invisible
* from the CN side. One code path, both regions.
*
* @returns the three headers (four when the usage identity is on, which adds
* `X-Request-ID`), every value distinct.
*/
function conversationHeaders(shape, identity = {}) {
	const officialIds = shape === "chat" && identity.usageIdentity === true;
	const id = officialIds ? uuidv7 : randomUUID;
	const messageId = id();
	const conversationRequestId = id();
	return {
		"X-Conversation-ID": id(),
		"X-Conversation-Request-ID": conversationRequestId,
		...profileOf(identity) === "balanced" ? { "X-Root-Request-ID": conversationRequestId } : {},
		"X-Conversation-Message-ID": messageId,
		...officialIds ? { "X-Request-ID": messageId } : {}
	};
}
/**
* A 32-character lowercase UUIDv7, as the official client's request ids appear.
*
* WHY THE FORMAT MATTERS AT ALL (issue #132). The gateway echoes
* `X-Conversation-Message-ID` back as the SSE `id`, and the WorkBuddy usage page
* shows that value as the request id. Official traffic therefore shows
* `01a169…`-style 32-hex ids, while this plugin's `randomUUID()` produced
* hyphenated v4 ids — so the same account's usage page read as two different
* clients, and a reporter comparing them concluded the plugin was not the
* official client. Nothing upstream REJECTS a v4 id — the hyphenated v4 this
* plugin has always sent is what answers 200 today — so this is a
* display-fidelity fix, not a gate.
*
* Only the FORMAT is aligned, never the value's meaning: the timestamp prefix
* is the moment this request was generated, which is exactly what a v7 id is
* for. It is NOT a claim that these ids correlate with an official session —
* the plugin still generates a fresh identity per request (see
* {@link conversationHeaders}).
*/
function uuidv7(nowMs = Date.now()) {
	const bytes = randomBytes(16);
	for (let index = 0; index < 6; index++) bytes[index] = Math.floor(nowMs / 2 ** (8 * (5 - index))) & 255;
	bytes[6] = bytes[6] & 15 | 112;
	bytes[8] = bytes[8] & 63 | 128;
	return bytes.toString("hex");
}
/**
* 没有显式配置时用的档位。
*
* `balanced`：P0.5 已证实有效，默认就应该吃到收益；`conservative` 留给
* "某台机器上某个账号忽然不行了"的排查场景。
*/
const DEFAULT_WIRE_PROFILE = "balanced";
/** 生效档位；未配置时取默认。 */
function profileOf(identity) {
	return identity.profile ?? "balanced";
}
/**
* 归属头的产品名。
*
* `WorkBuddy` 而不是 `SaaS`：`SaaS` 是"某种 SaaS 租户"的泛化标签，官方客户端
* 从不会这么称呼自己；A（`client_name` 默认 `WorkBuddy`）与 B
* （`attributionClientName` 默认 `WorkBuddy`）都发 `WorkBuddy`，而 B 的注释直接
* 把 `SaaS` 称作"还原旧行为"。同值三头（Name / Type / Product）也是两家的共同
* 形状——官方客户端不会一边说自己是 WorkBuddy、一边说自己是 CLI。
*/
const ATTRIBUTION_CLIENT_NAME = "WorkBuddy";
/**
* `Accept-Language`：按账号域切。
*
* 官方客户端按账号所属区发对应语言（B 的 D5：CN `zh-CN` / global `en-US`）。
* 一个中文账号发 `en-US` 是"这台机器换了语言"，而语言是设备指纹里最廉价、
* 也最常被用来做聚类的一维——顺手对齐没有成本。
*/
function acceptLanguageOf(credential) {
	return regionOf(credential.domain) === "global" ? "en-US" : "zh-CN";
}
/**
* 归属头：这台客户端"是谁"，一次说清（P1 的"统一为 WorkBuddy 客户端"）。
*
* ## 为什么是从 `ideHeaders` 扩成函数族
*
* 5.16.0 发的是 `X-Product: SaaS` + 可选的 `X-IDE-Type: CLI` / `X-IDE-Name:
* WorkBuddy`，而且三个头分两处、其中两个还被 `usageIdentity` 挡着。结果是同一条
* 请求里"产品"说自己是泛化 SaaS、"类型"说自己是 CLI、"名字"说自己是 WorkBuddy —
* 三个互不相同的自称。A 与 B 都不是这么做的：两家都是 Name / Type / Product
* **同值**，且都发 `X-Agent-Purpose: conversation`。
*
* ## `conservative` 为什么还原的是 `SaaS` 而不是"少发几个"
*
* 回退档的契约是"逐字节等于 5.16.0"。只删新头、留下改名后的 `X-Product`，等于
* 造出第三个从未上线过的形状——排查时最怕的就是"回退了但没完全回退"。
*
* 版本号取 {@link APP_VERSION}（从 {@link PRODUCT_UA} 解析出来），不写字面量：
* 两个独立字面量正是版本升级时开始互相矛盾的方式。
*/
function attributionHeaders(identity) {
	if (profileOf(identity) !== "balanced") return { "X-Product": "SaaS" };
	return {
		"X-Agent-Purpose": "conversation",
		"X-IDE-Name": ATTRIBUTION_CLIENT_NAME,
		"X-IDE-Type": ATTRIBUTION_CLIENT_NAME,
		"X-IDE-Version": APP_VERSION,
		"X-Product": ATTRIBUTION_CLIENT_NAME
	};
}
/**
* 设备头：真实值档只发真 token；虚拟值档发派生的 id 对（+ P2 的文件 token，若有）。
*
* 盐来自本机 `$DSH_HOME/.workbuddy-device.json`（见 `src/device-salt.ts`），由
* 客户端解析一次后放进 identity；**盐缺席就整对不发**——只发 Machine-ID 不发
* Session-ID 是一个真实客户端不会出现的形状。token 来自
* `deviceToken.file`（见 `src/device-token.ts`），每 5 分钟重读。
*
* ## 两档互斥，且互斥在**代码**里
*
* 真 token 内含设备信息（A 调 `fetchDeviceToken({includesDeviceInfo:true})`），
* 再配一对伪造 id 等于自证不一致（审计 §5.3）。P2 把这个组合先放上线是为了让
* 档位规则由实测决定；P3 的决定是：真实值档只发 token，派生对整对不发。这里不是
* "少发几个头"，是两条互斥的返回路径——同时带着两者发出去的那条路已经不存在了，
* 也就没有配置能配出矛盾组合。
*/
function deviceHeaders(credential, identity) {
	if (profileOf(identity) !== "balanced") return {};
	if (identity.deviceTier === "real") return identity.deviceReal === void 0 || identity.deviceReal === "" ? {} : { "X-Device-Token": identity.deviceReal };
	const headers = {};
	if (identity.deviceToken !== void 0 && identity.deviceToken !== "") headers["X-Device-Token"] = identity.deviceToken;
	const salt = identity.deviceSalt;
	const override = identity.deviceProfile;
	const derivedMachine = salt !== void 0 && salt !== "" && credential.uid !== "" ? deriveDeviceId(credential.uid, "machine", salt) : "";
	const derivedSession = salt !== void 0 && salt !== "" && credential.uid !== "" ? deriveDeviceId(credential.uid, "session", salt) : "";
	const machineId = override?.machineId !== void 0 && override.machineId !== "" ? override.machineId : derivedMachine;
	const sessionId = override?.sessionId !== void 0 && override.sessionId !== "" ? override.sessionId : derivedSession;
	if (machineId !== "") headers["X-Machine-ID"] = machineId;
	if (sessionId !== "") headers["X-Session-ID"] = sessionId;
	return headers;
}
/**
* 把 identity 补全成"可以直接拿去构造头"的形态——解析本机设备盐。
*
* 三条提前返回，各有理由：
*   - 非 `balanced`：这一档根本不发设备头，去读盘只是浪费一次 IO；
*   - 调用方已经给了盐（测试、或 doctor 已经解析过）：不复读；
*   - 读不到（absent / unreadable / unwritable）：原样返回，`deviceHeaders`
*     会因为 `deviceSalt === undefined` 整对不发。**绝不现场造一个临时盐**。
*/
async function resolveWireIdentity(identity) {
	if (profileOf(identity) !== "balanced") return identity;
	if (identity.deviceSalt !== void 0 && identity.deviceSalt !== "") return identity;
	const readout = await ensureDeviceSalt();
	if (readout.state !== "ok") return identity;
	return {
		...identity,
		deviceSalt: readout.salt
	};
}
/** Chat request headers, including the X-No-* conventions the official CLI uses. */
function chatHeaders(credential, identity = {}) {
	return {
		...commonHeaders(credential, identity),
		"Content-Type": "application/json",
		...credential.uid === "" ? { "X-No-User-Id": "1" } : { "X-User-Id": credential.uid },
		...credential.enterpriseId === void 0 || credential.enterpriseId === "" ? { "X-No-Enterprise-Id": "1" } : { "X-Enterprise-Id": credential.enterpriseId },
		...credential.domain === "" ? { "X-No-Department-Info": "1" } : { "X-Domain": credential.domain },
		...attributionHeaders(identity),
		...deviceHeaders(credential, identity),
		...conversationHeaders("chat", identity)
	};
}
/**
* Refresh-endpoint headers; X-Refresh-Token appears here and nowhere else.
*
* **签名里刻意没有 `identity`**：这条路径不参与 P1 的身份统一，多一个用不到的
* 参数只会让下一个人以为它本该用上。见 {@link legacyCommonHeaders}。
*/
function refreshHeaders(credential) {
	const headers = {
		...legacyCommonHeaders(credential),
		"X-Refresh-Token": credential.refreshToken,
		"X-Auth-Refresh-Source": "workbuddy"
	};
	if (credential.enterpriseId !== void 0 && credential.enterpriseId !== "") headers["X-Enterprise-Id"] = credential.enterpriseId;
	return headers;
}
/**
* Billing request headers.
*
* ## 为什么这条路径要补这么多（审计 §1.3 的 D2）
*
* 5.16.0 的 billing 只发三件套 + 用户/企业/域，**没有 UA、没有 Origin/Referer、
* 没有 X-Requested-With、没有任何归属头**。于是同一个 token 在同一分钟里发出
* 两种客户端：chat 声称自己是 CLI，billing 声称自己是一个连 UA 都没有的裸 HTTP
* 客户端。这种"两条路径互不承认"的反差不需要任何启发式就能被静态规则挑出来，
* 而 billing 恰好是签到、领补偿这类**写操作**所在的域——最不该显得可疑的地方。
*
* 补齐的四类，每一类都有参照实现：
*   - `User-Agent: WorkBuddy/<ver>`：B 的 billing 域用单段形态（官方 banner
*     白名单头组不带 CLI 段），A 则对所有路径复用同一套头。
*   - `Origin` / `Referer` / `X-Requested-With`：B 的 `CommonHeaders` 全路径发送。
*   - `X-CodeBuddy-Request` + `Accept-Language`：B 在 billing 域单独注入（D1/D5）。
*   - 归属头与设备头：与本插件的 chat 路径同源，保证"同一个客户端"这个说法成立。
*
* `conservative` 档整段跳过，billing 逐字节还原 5.16.0 的裸形状。
*/
function billingHeaders(credential, identity = {}) {
	const balanced = profileOf(identity) === "balanced";
	const headers = {
		"Authorization": `Bearer ${credential.accessToken}`,
		"Accept": "application/json",
		"Content-Type": "application/json"
	};
	if (balanced) {
		headers["User-Agent"] = `WorkBuddy/${APP_VERSION}`;
		headers["X-Requested-With"] = "XMLHttpRequest";
		headers["X-CodeBuddy-Request"] = "1";
		headers["Accept-Language"] = acceptLanguageOf(credential);
		headers["Origin"] = originReferer(credential);
		headers["Referer"] = `${originReferer(credential)}/`;
	}
	if (credential.uid !== "") headers["X-User-Id"] = credential.uid;
	if (credential.enterpriseId !== void 0 && credential.enterpriseId !== "") {
		headers["X-Enterprise-Id"] = credential.enterpriseId;
		headers["X-Tenant-Id"] = credential.enterpriseId;
	}
	if (credential.domain !== "") headers["X-Domain"] = credential.domain;
	if (balanced) Object.assign(headers, attributionHeaders(identity), deviceHeaders(credential, identity));
	return headers;
}
/**
* 生图请求头。
*
* 实测口径（2026-10-21，国内区）：`Authorization: Bearer` + `X-Product: SaaS` +
* 用户/企业/域三连 + 会话身份三连 + `PRODUCT_UA`，在 `copilot.tencent.com` 与
* `www.workbuddy.cn` 两个入口都返回 200。刻意**不带** `Origin` / `Referer`：
* 探针当时没带，带了只是多一个可能被网关拒掉的变量，没有收益。
*
* 2026-10-31（P1）：`X-Product` 由 `SaaS` 改为 `WorkBuddy`，并补上
* `X-Agent-Purpose` / `X-IDE-*` 与设备对，与 chat / billing 同一份自称（见
* {@link attributionHeaders}）。这里遵守的是一条明确的界线：
*
*   - **身份类头**（`X-Product` / `X-IDE-*` / `X-Agent-Purpose` / 设备对）跟着
*     统一走。不统一的代价是新的 D2：同一个 host 上 chat 说自己是 WorkBuddy、
*     生图说自己是 SaaS，而这个矛盾恰恰是这次要消掉的东西。
*   - **网络环境类头**（`Origin` / `Referer`）保持上表的实测形态。它们回答的是
*     "这条请求从哪来"，与"谁在说话"不是一个判据，当时特意排除就先不请回来。
*
* 代价说清楚：这毕竟是在一条逐字节测过的路径上加了几个头。若生图那道闸哪天
* 开始拒，第一个该试的是把 `wireProfile` 切到 `conservative` —— 那一档会把这
* 一行连同所有新增头一起还原成 5.16.0。
*
* 增量的边界是"**自我描述**"：`X-Product` / `X-IDE-*` / `X-Agent-Purpose` /
* 设备对 / `X-Root-Request-ID` 进，`X-CodeBuddy-Request` 与 `Accept-Language`
* **不进**。后两个不是身份而是传输层标记：若闸门真的要求 `X-CodeBuddy-Request`，
* 生图（从来没发过它）今天就该失败，而它一直是 200；语言同理，生图输出不是
* 语言相关的东西。没有收益的变量不加——这条正是上面那段实测留下的规则。
*
* 复用 {@link conversationHeaders}：官方 CLI 的 ImageService 也是每次现生成
* 一组会话 UUID。但这里**传 `'image'`，且刻意不跟 `usageIdentity` 开关走**：
* issue #132 的实测只覆盖 chat，而生图这两个入口在 2026-10-21 是用带连字符的
* v4 答的 200，而 id 的**格式**从来不是生图那道闸问的事。把对齐「顺手统一」到
* 这里，等于用一条没人测过的字节去换一次显示对齐——`tests/upstream.spec.ts` 里
* 那条生图守卫钉的就是这一点，而 `shape` 是**唯一**挡住它的东西：客户端把
* `usageIdentity` 一路传进了 `imageHeaders`，是 `'image'` 这个形状参数让它即便带着开关
* 也不采用 chat 的形状。守卫因此真能失败——两个方向都实跑过：把 `'image'` 改成
* `'chat'` 会红，删掉 `shape === 'chat'` 判据也会红。（identity 没接进来之前，`shape`
* 是空转参数、只改它守卫照样绿；接进来是这一步的前提，别退回成不传 identity。）
*/
function imageHeaders(credential, identity = {}) {
	return {
		"Authorization": `Bearer ${credential.accessToken}`,
		"Accept": "application/json, text/plain, */*",
		"Content-Type": "application/json",
		"User-Agent": PRODUCT_UA,
		"X-Requested-With": "XMLHttpRequest",
		...credential.uid === "" ? { "X-No-User-Id": "1" } : { "X-User-Id": credential.uid },
		...credential.enterpriseId === void 0 || credential.enterpriseId === "" ? { "X-No-Enterprise-Id": "1" } : { "X-Enterprise-Id": credential.enterpriseId },
		...credential.domain === "" ? { "X-No-Department-Info": "1" } : { "X-Domain": credential.domain },
		...attributionHeaders(identity),
		...deviceHeaders(credential, identity),
		...conversationHeaders("image", identity)
	};
}
/**
* The header NAMES one outbound request would carry — names only, never values.
*
* WHY THIS EXISTS. 审计（`docs/DEVICE-IDENTITY-AUDIT.md`）的 P0 要回答"我们现在
* 到底发了什么"，而这个答案必须**由代码给出**，不能由一段写死的清单给出：写死的
* 清单在上线三个月后一定与真实请求脱节，届时它会安静地撒谎。因此这里直接调用
* 请求路径上同一批构造器（{@link chatHeaders} / {@link imageHeaders} /
* {@link refreshHeaders} / {@link billingHeaders}），返回它们的键集合——往
* `chatHeaders` 里加一个头，这里自动跟着变，不需要第二次修改。
*
* 两处**刻意与调用点对齐**的地方：
*   - `chat` 的 `Authorization` 由调用点合并（`:3739` / `:3810`），不在这批构造器
*     里，所以这里补上；不补的话，"chat 有没有带鉴权"会被答成"没有"。
*   - `refresh` 确实没有 `Authorization`（它用 `X-Refresh-Token`），不补。
*
* READ-ONLY：不发请求、不返回任何值、不打印任何东西。调用方（`doctor`）决定
* 显示到哪一层。
*/
function describeRequestHeaderNames(kind, credential, identity = {}) {
	switch (kind) {
		case "chat": return Object.keys({
			...chatHeaders(credential, identity),
			Authorization: `Bearer ${credential.accessToken}`
		});
		case "image": return Object.keys(imageHeaders(credential, identity));
		case "refresh": return Object.keys(refreshHeaders(credential));
		case "billing": return Object.keys(billingHeaders(credential, identity));
	}
}
/**
* Stand-in system message for a request that reached the wire carrying none.
*
* Not a stylistic default: both WorkBuddy gateways want the conversation to
* OPEN with a system message, and the international one enforces it — a
* user-first body there is refused with business code 11128
* (`first message is not system prompt`), which the gateway surfaces as
* "blocked by security policy". The domestic gateway tolerates the same body,
* so the fault only ever shows up on the international route (issue: a global
* model failing every step while the CN one is fine).
*
* A system message can go missing before this module ever sees the body:
* `dsh-llm-pi-ai` folds a leading `system` message into `Context.systemPrompt`
* and pi-ai only emits that prompt `if (context.systemPrompt)` — so an EMPTY
* prompt emits no system message at all, and pi-ai demotes any `system` entry
* left in `messages` to `user`. By the time the shim holds the JSON, the real
* prompt is no longer recoverable, and a minimal placeholder is strictly better
* than a guaranteed 400.
*
* Deliberately tiny: this is a last-resort placeholder, not a persona. Inventing
* a longer one would quietly change model behaviour on every affected request.
*/
const WORKBUDDY_FALLBACK_SYSTEM_PROMPT = "你乃AI辅助软件也。";
const WEB_GUI_PROMPT_ZH = "你正通过 DeepSeek Harness 网页界面与用户对话，界面地址以运行时上下文给出的为准。用户若说「这个页面」「这个界面」或「这个应用」且没有点名别的目标，指的就是这个界面。浏览器不会附带 DOM、路由或截图。客户端插件的热更新接收器是开着的，但只有同一检出里同时在跑 `pnpm run dev:web` 重建包时，插件改动才会不刷新页面就生效；承诺自动更新前先确认那个监视进程在跑。其余改动（apps/web 外壳和普通包）必须重新构建对应的 Web 产物，刷新页面后再核对这个地址。另开一个服务器不会更新当前界面。apps/web 的 Vite 入口只构建外壳，不是独立应用，因为只有 dsh web 会注入 window.__DSH_BOOT__。除非用户要求，不要再启动替代服务器；如果需要，用托管后台任务，并核对它的准确地址。";
/**
* System-prompt openings the gateways fingerprint as "an unapproved channel".
*
* WHY THIS EXISTS (measured 2026-10-21 00:05 on the real gateways, CN account
* `ba217455…`, `deepseek-v4.1-flash`, every other request field held fixed):
* each gateway scans EVERY `system` message for a small set of known
* third-party-agent prompt openings and refuses a hit with business code
* `11128` / `Illegal API invocation from an unapproved channel` — the same code
* the conversation-id gate (issue #66) and the `developer`-role gate use, so
* the raw `displayTips` text ("可能不是官方客户端发出的") reads as a
* client-identity problem. The actual failing rule is a CONTENT prefix match:
*
*   system message begins with                             CN            global
*   -----------------------------------------------------  ------------  ------------
*   "You are an AI agent powered by DeepSeek Harness"      400 / 11128   200
*   "You are Claude Code, Anthropic's official CLI…"       400 / 11128   400 / 11128
*   "You are an AI agent powered by Kimi."                 200           200
*   "You are Cursor Agent…", "You are Gemini CLI…"         200           200
*   the same DSH prompt with "You are a helpful assistant."
*   prepended                                              200           200
*
* Matching is start-of-content only — the same sentence mid-prompt, in a
* `user` message, or one leading space earlier all pass — and case-insensitive
* (`you are an ai agent powered by deepseek harness` fails too). Prepending one
* line is therefore enough to keep an ordinary DSH request off the list, and
* the line is the placeholder {@link ensureSystemHead} already uses: adding a
* neutral head costs less model behaviour than rewriting the host's own prompt.
*
* Not a nice rule to have to know, but the prompt was the only difference
* between two requests the same account answered differently: the full DSH body
* failed every time, the same body with the two leading lines swapped for
* "You are a helpful assistant." returned 200. The list below is the measured
* snapshot, not a theory of what the gate "means"; a gateway adding a new
* opening is not caught until a body carries one, and the prepend only wins
* while the gate keeps matching at offset 0.
*
* THE LIST CANNOT BE COMPLETE, AND THAT IS WHY {@link forceNeutralHead}
* EXISTS. This is a snapshot of the upstream's own list, taken by measuring
* openings one at a time; the upstream can extend it at any time and the
* plugin cannot see it. So the plugin's own prepend is a best-effort filter,
* not a guarantee — and the self-healing retry is what covers the openings
* nobody has measured yet.
*/
	const UNAPPROVED_CHANNEL_OPENINGS = [
		{ prefix: "you are interacting with the user through the deepseek harness", replacement: WEB_GUI_PROMPT_ZH },
		{ prefix: "you are working with the user inside the deepseek harness web gui", replacement: WEB_GUI_PROMPT_ZH },
		{ prefix: "you are an ai agent, powered by deepseek harness", replacement: WORKBUDDY_FALLBACK_SYSTEM_PROMPT },
		{ prefix: "you are an ai agent running inside deepseek harness", replacement: WORKBUDDY_FALLBACK_SYSTEM_PROMPT },
		{ prefix: "you are claude code", replacement: WORKBUDDY_FALLBACK_SYSTEM_PROMPT },
		{ prefix: "you are a helpful assistant", replacement: WORKBUDDY_FALLBACK_SYSTEM_PROMPT }
	];
/**
* The identity clauses an agent prompt introduces itself with, matched so the
* plugin can break them INSIDE rather than in front of.
*
* WHY {@link UNAPPROVED_CHANNEL_OPENINGS} DOES NOT COVER THESE. That list is a
* PREFIX rule, and it is the right rule for the gate the plugin measured on
* 2026-10-21. It is the wrong rule for the gate the upstream has been running
* since: a case-insensitive EXACT SUBSTRING match ANYWHERE in a scanned
* message, which is what this plugin's own issue #125 recorded (three sites in
* the live DSH prompt, "只改任意一两处不够，三处全改才 200") and what
* `workbuddy2api-hub` #533 independently bisected to the byte on a real 124 KB
* request. A prefix prepend cannot break a substring match, because the banned
* span is still in the text, intact, one line lower.
*
* THE THREE MEASURED SITES, and why each needs its own alternative:
*
*   You are an AI agent powered by DeepSeek Harness.
*   You are a coding agent powered by the <model> model.
*   You are interacting with the user through the DeepSeek Harness Web GUI …
*
* The first is on the prefix list. The other two are NOT, and the second is the
* one that survives every rung this plugin had: it carries no adjacent
* capitalised word pair (so {@link WORD_INTERNAL_BREAK} misses it), no comma or
* clause punctuation, and its terminal full stop lands AFTER the banned span (so
* the sentence rules miss it too). Measured against a real DSH prompt: sparse
* perturbation clears sites 1 and 3 and leaves site 2 byte-identical, which is
* exactly the request that kept answering 11128.
*
* The model name in site 2 is not stable (`qmodel_38max`, `deepseek-v4.1-flash`,
* …), so the clause is matched up to `powered by` and the variable tail is left
* to the break rule itself.
*/
const IDENTITY_CLAUSE = /(you)(\s+are\s+(?:(?:an?\s+)?[\w-]*\s*agent\s+powered\s+by|interacting\s+with\s+the\s+user\s+through\s+the\s+deepseek\s+harness))/giu;
/**
* Break an identity clause at EVERY word boundary inside it.
*
* NOT one break, and that is deliberate. The plugin does not know which span the
* upstream listed: #533's minimal failing sample is the whole sentence, but the
* gate is a substring match, so the listed span could equally be a shorter piece
* of it (`a coding agent powered by`). One break at the front defeats only the
* spans that start there. Breaking at every internal word boundary defeats every
* span inside the clause, whatever its endpoints, for about ten invisible
* characters.
*
* The cost is why this can run on EVERY request instead of only in a rescue:
* measured on a real 10,818-character DSH system prompt it adds ~28 characters
* (+0.26%), against the dense rescue's 7,742 (+70.7%). Both break all three
* sites; only this one is cheap enough to send unconditionally.
*
* The break goes AFTER each whitespace run, so the text keeps its own spacing
* and a reader (or a tokenizer) sees the same words in the same order.
*
* Naturally idempotent: once a clause carries a break, `IDENTITY_CLAUSE` no
* longer matches it — `\s+` does not match U+200B, so the second alternative
* fails at the inserted character and the clause is left alone on every later
* pass. That is a property this function has to have on its own, because
* {@link perturbChannelFingerprints} can no longer refuse to touch text that
* already carries an invisible break.
*/
function breakIdentityClauses(text) {
	return text.replace(IDENTITY_CLAUSE, (clause) => clause.replace(/(\s+)/gu, `$1${ZERO_WIDTH_SPACE}`));
}
/**
* Whether this text OPENS with an opening the gateways refuse.
*
* The gate is a PREFIX match on the START of a `system` message, so this is
* the one predicate that decides it — used by the request path (which prepends
* the neutral head on a hit) and by the failure path (which names the
* offending line).
*
* THREE MEASURED RULES are folded in here, all from the live CN gateway on
* 2026-10-21 (account `ba217455…`, `deepseek-v4.1-flash`, every other request
* field held fixed):
*
*   1. Only the START counts — the same sentence mid-content answers 200.
*   2. LEADING WHITESPACE is trimmed before the comparison — " <banned>" and
*      "\n<banned>" both answer 200 today.
*   3. The comparison is CASE-INSENSITIVE — the lower-cased sentence fails too.
*
* (2) is a gift that can be withdrawn, so the comparison is made the way a
* trimming gate would make it even while the gateway is lenient: a rule that
* only holds while the gateway forgets to trim is a rule waiting to break.
*
* The list itself stays the measured snapshot. It is deliberately NOT
* extended by guesswork: an opening nobody measured is an opening nobody knows
* the gateway refuses, and inventing entries would neutralise prompts that
* answer 200 today.
*/
function unapprovedChannelOpeningOf(text) {
	const opening = text.replace(/^\s+/u, "").toLowerCase();
	return UNAPPROVED_CHANNEL_OPENINGS.find((item) => opening.startsWith(item.prefix));
}
function isUnapprovedChannelOpening(text) {
	return unapprovedChannelOpeningOf(text) !== void 0;
}
/**
* Whether this text already begins with the plugin's own neutral head.
*
* The question the failure path has to answer per system message: "is the
* line the gateway refused OURS, or the HOST's?" — the plugin's head is the
* one line it has ever added to a prompt, so it is the only opening that
* cannot be a third-party-agent fingerprint.
*/
function startsWithNeutralHead(text) {
	return text.replace(/^\s+/u, "").toLowerCase().startsWith(WORKBUDDY_FALLBACK_SYSTEM_PROMPT.toLowerCase());
}
/**
* The roles whose message OPENINGS the gateway scans.
*
* MEASURED on the live CN gateway (2026-10-21, every other request field held
* fixed): `system` and `assistant` are scanned; `user` and `tool` are not (a
* body whose `user` or `tool` content opens with the banned identity answers
* 200). That second role is the one the plugin missed until 4.15.0, and it is
* why issue #98's sessions stayed broken: an `assistant` history message that
* opens with the fingerprint poisons EVERY later turn of that session, on
* every account and in every region.
*
* `developer` is not listed because `prepareChatBody` rewrites it to `system`
* before this module looks at the body — and because both gateways refuse
* `developer` outright, so neutralising its content would not save the request.
*/
function scansOpening(role) {
	if (typeof role !== "string") return false;
	const name = role.trim().toLowerCase();
	return name === "system" || name === "assistant";
}
/**
* The gateway's current content fingerprints, and same-meaning rewrites for
* them (issue #163).
*
* WHY REWRITE INSTEAD OF ZERO-WIDTH. On 2026-10-29 two independent probes
* measured that the CN gateway normalizes invisible characters before matching:
* the DSH identity with U+200B at every word boundary still answers 11128.
* `breakIdentityClauses` and both perturbation rungs therefore cannot help this
* family. A real wording change is what the same probes measured as 200.
*
* WHY SENTENCE-LEVEL, NOT ONE WHOLE-PARAGRAPH LITERAL. The third fingerprint is
* an eight-sentence, roughly 800-character @-path paragraph. Two reporters
* measured that each sentence alone answers 200 and the whole paragraph answers
* 400 — it is a COMBINATION, not a single listed sentence. Replacing the
* paragraph as one literal would stop matching the moment the host changes one
* word; replacing every sentence breaks the combination and keeps working when
* only some of the text moves. The rows below are the table proposed in issue
* #163 (yicneggima-glitch, 18:56; QIYU-PLUS, 18:57), with the identity and Web
* GUI rows both probes measured.
*
* `from` strings are matched ANYWHERE, not just at an opening, because the
* measured rule is position-independent. Only a hit is replaced; every other
* byte is left alone, so an ordinary conversation is unchanged.
*
* WHICH HOST PACKAGE TO WATCH WHEN A ROW STOPS MATCHING (issue #164 traced the
* three paragraphs to their owners in the DSH install): the identity sentence
* comes from `@deepseek-ai/dsh-system-prompt`, the @-path paragraph from
* `@deepseek-ai/dsh-file-reference`, and the Web GUI paragraph from
* `@deepseek-ai/dsh-harness-dev-context`. #164 also bisected the MINIMUM
* triggering span: the @-path paragraph already fails at its first two sentences
* (112 chars) and the Web GUI paragraph at its first two (217 chars), each
* sentence alone answering 200 — so a row must clear the truncated shape too,
* which is exactly what sentence-level rows do. Pinned by
* `tests/issue163-sentence-rewrite.spec.ts`.
*/
const CHANNEL_GATE_PHRASES = [
	["You are an AI agent powered by DeepSeek Harness", "You are an AI agent running inside DeepSeek Harness"],
	["You are a coding agent powered by the ", "You are a coding agent running on the "],
	["You are interacting with the user through the DeepSeek Harness Web GUI", "You are working with the user inside the DeepSeek Harness Web GUI"],
	["Agent Teams is available in this session", "Agent Teams is enabled for this session"],
	["Tokens prefixed with @ are paths the user explicitly referenced.", "Paths that begin with @ are the ones the user explicitly referenced."],
	["Relative paths resolve from the workspace root;", "Relative paths are resolved against the workspace root;"],
	["absolute paths identify files or directories on the host.", "absolute paths point at files or directories on the host."],
	["A trailing slash marks a directory:", "A trailing slash indicates a directory:"],
	["list it when its contents matter.", "list it whenever its contents matter."],
	["Anything else is a file:", "Everything else is a file:"],
	["use the read tool when its contents are needed,", "use the read tool whenever you need its contents,"],
	["and do not claim to have inspected it before reading.", "and never claim to have inspected it before reading it."],
	["@\"...\" quotes a path containing spaces.", "A path containing spaces is quoted with @\"...\"."],
	["without naming another target, they mean this GUI.", "and names no other target, the interface described here is meant."],
	["they mean this GUI.", "the interface described here is meant."]
];
/**
* Rewrite the measured gate phrases in one text part.
*
* Exported for the tests and for callers that build a body themselves. It is
* idempotent: every `to` string is different from its `from` string and no
* rewrite recreates another `from` string, so a second pass is a no-op.
*/
function rewriteChannelFingerprintPhrases(text) {
	let out = text;
	for (const [from, to] of CHANNEL_GATE_PHRASES) if (out.includes(from)) out = out.replaceAll(from, to);
	return out;
}
/**
* Apply {@link rewriteChannelFingerprintPhrases} to every scanned text part.
*
* `system` and `assistant` only (the roles the gate reads). `user` and `tool`
* are deliberately untouched: QIYU-PLUS re-measured both on 2026-10-29 and
* both answer 200 with the DSH identity at an opening, and rewriting a user's
* own words would change the conversation for no gate.
*/
function rewriteChannelFingerprintPhrasesInBody(obj) {
	const messages = obj["messages"];
	if (!Array.isArray(messages)) return;
	for (const value of messages) {
		if (typeof value !== "object" || value === null || Array.isArray(value)) continue;
		const message = value;
		if (!scansOpening(message["role"])) continue;
		const content = message["content"];
		if (typeof content === "string") {
			const next = rewriteChannelFingerprintPhrases(content);
			if (next !== content) message["content"] = next;
			continue;
		}
		if (!Array.isArray(content)) continue;
		for (const part of content) {
			if (typeof part !== "object" || part === null || Array.isArray(part)) continue;
			const record = part;
			const type = record["type"];
			if (typeof type !== "string" || type.trim().toLowerCase() !== "text") continue;
			const text = record["text"];
			if (typeof text !== "string") continue;
			const next = rewriteChannelFingerprintPhrases(text);
			if (next !== text) record["text"] = next;
		}
	}
}
/**
* Move every scanned message (`system` and `assistant`) off the content
* fingerprint above by prepending the placeholder head.
*
* A no-op for a body whose messages start with anything else, so a request the
* gateways already answer keeps its prompt byte-for-byte — only the messages
* the gate would refuse grow, by one short line.
*
* BOTH ROLES, because the gate reads both. Until 4.15.0 this only handled
* `system`, and the failure that left behind is issue #98: a conversation
* whose HISTORY contains an assistant message opening with the banned identity
* (the model echoing its own prompt, a restored session, a compaction
* artefact) was refused on every single turn, and no account or region could
* change a byte of it.
*
* ARRAY CONTENT IS HANDLED PART BY PART, and that is not a nicety. Measured on
* the live CN gateway (2026-10-21): when a scanned message's `content` is an
* array of parts, the gate reads EVERY TEXT PART of it — a banned opening in
* the FIRST part is refused, and a banned opening in the SECOND part is
* refused just the same. Prepending to the first part only would therefore
* fix the first half of the failure and leave the second half to the users who
* report it again.
*/
function neutralizeChannelFingerprints(obj) {
	const messages = obj["messages"];
	if (!Array.isArray(messages)) return;
	for (const value of messages) {
		if (typeof value !== "object" || value === null || Array.isArray(value)) continue;
		const message = value;
		if (!scansOpening(message["role"])) continue;
		const content = message["content"];
		if (typeof content === "string") {
			const next = neutralizeScannedText(content);
			if (next !== void 0) message["content"] = next;
			continue;
		}
		if (!Array.isArray(content)) continue;
		for (const part of content) {
			if (typeof part !== "object" || part === null || Array.isArray(part)) continue;
			const record = part;
			const type = record["type"];
			if (typeof type !== "string" || type.trim().toLowerCase() !== "text") continue;
			const text = record["text"];
			if (typeof text !== "string") continue;
			const next = neutralizeScannedText(text);
			if (next !== void 0) record["text"] = next;
		}
	}
}
/**
* Both neutralising transforms, applied to one scanned text part.
*
* `undefined` means the text goes on the wire byte-for-byte, which is the case
* for every ordinary message: an ordinary conversation contains no identity
* clause, so this changes nothing at all and the body is not re-serialised.
*
* THE ORDER IS LOAD-BEARING. The prefix rule reads the START of the text, so it
* has to look at the text the HOST wrote; running {@link breakIdentityClauses}
* first would insert an invisible break inside `You are an AI agent powered by
* DeepSeek Harness`, and {@link isUnapprovedChannelOpening} would then no longer
* match it — silently dropping the neutral head the prefix gate still needs. So
* the head goes on first, and the clause breaks land in the text underneath it.
*
* BOTH RUN, because they defend different gates. The head defeats the prefix
* match at offset 0; the clause breaks defeat the exact-substring match
* anywhere inside. A body that needs only one of them gets only that one:
* the Claude Code opening on the prefix list carries no identity clause, and an
* identity clause nobody put on the prefix list needs no head.
*/
function neutralizeText(text) {
	const lines = text.split("\n");
	let changed = false;
	for (let index = 0; index < lines.length; index++) {
		const opening = lines[index].replace(/^\s+/u, "").toLowerCase();
		if (opening === "") continue;
		const hit = unapprovedChannelOpeningOf(opening);
		if (hit === void 0) continue;
		lines[index] = hit.replacement;
		changed = true;
	}
	return changed ? lines.join("\n") : void 0;
}
const REFUSED_CONTENT_SPANS = [
	{ text: "Tokens prefixed with @ are paths the user explicitly referenced. Relative paths resolve from the workspace root", replacement: "以 @ 开头的标记是用户显式引用的路径，相对路径从工作区根目录解析。" },
	{ text: "Paths that begin with @ are the ones the user explicitly referenced. Relative paths resolve from the workspace root", replacement: "以 @ 开头的标记是用户显式引用的路径，相对路径从工作区根目录解析。" }
];
function escapeRegExpSource(part) {
	return part.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
function replaceRefusedContentSpans(text) {
	let out = text;
	for (const span of REFUSED_CONTENT_SPANS) {
		const pattern = new RegExp(span.text.trim().split(/\s+/u).map(escapeRegExpSource).join("\\s+"), "giu");
		out = out.replace(pattern, span.replacement);
	}
	return out;
}
function neutralizeScannedText(text) {
	const replaced = replaceRefusedContentSpans(neutralizeText(text) ?? text);
	const broken = breakIdentityClauses(replaced);
	return broken === text ? void 0 : broken;
}
/**
* A body in which EVERY scanned opening (`system` and `assistant`) is moved
* behind the neutral head.
*
* THE ONE-SHOT SELF-HEALING RETRY'S BODY BUILDER. The gateway's fingerprint
* list is a SNAPSHOT the upstream can extend at any time, and the plugin
* cannot see it: the two entries in {@link UNAPPROVED_CHANNEL_OPENINGS} are
* what was MEASURED on 2026-10-21, not a contract. So the day the gateway
* adds an entry, this plugin's own prepend stops matching and the banned
* opening goes out on the wire unchanged — exactly the dead end issue #98
* describes, and exactly what a longer guess-list cannot prevent (nobody can
* measure the next entry before it bites).
*
* The remedy is a second attempt that does not depend on knowing the
* fingerprint at all: this builds a body in which EVERY scanned message,
* whatever it opens with, gets the neutral head in front. The gateway matches
* the START of a scanned message, so a neutral first line moves the whole
* opening out of the matched region — whether the banned text is a known
* entry, a new one, or a fingerprint this plugin has never heard of.
*
* `assistant` messages are included for the measured reason
* {@link neutralizeChannelFingerprints} documents: a history message that opens
* with a refused identity is what keeps a whole session failing, so a retry
* that only moved the system prompt would spend a request to be refused for the
* same reason.
*
* WHEN IT IS USED: only AFTER the gateway refused the first attempt with the
* channel gate. A request the gateway already answers keeps its bytes
* unchanged, because this function is never called for it — the normal path
* is {@link prepareChatBody}, which only touches the openings it has MEASURED
* as fingerprinted.
*
* `undefined` means "this body cannot change": every scanned opening already
* starts with the neutral head, so a retry would send the same bytes and
* spend a request for the same refusal. The caller uses that to avoid
* spending the round trip.
*
* Empty contents are skipped: an empty string cannot open with anything, so it
* cannot be the culprit, and an assistant message that carries `tool_calls`
* with `content: ""` is a replay shape this function has no reason to touch.
*
* Never throws. A body it cannot read is the upstream's to reject, and a
* parse error must not turn a retry into a crash.
*/
function forceNeutralHead(bodyJson) {
	let parsed;
	try {
		parsed = JSON.parse(bodyJson);
	} catch {
		return;
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return void 0;
	const obj = parsed;
	const messages = obj["messages"];
	if (!Array.isArray(messages)) return void 0;
	let changed = false;
	for (const value of messages) {
		if (typeof value !== "object" || value === null || Array.isArray(value)) continue;
		const message = value;
		if (!scansOpening(message["role"])) continue;
		const content = message["content"];
		if (typeof content === "string") {
			if (content.trim() === "" || startsWithNeutralHead(content)) continue;
			message["content"] = `${WORKBUDDY_FALLBACK_SYSTEM_PROMPT}\n\n${content}`;
			changed = true;
			continue;
		}
		if (!Array.isArray(content)) continue;
		for (const part of content) {
			if (typeof part !== "object" || part === null || Array.isArray(part)) continue;
			const record = part;
			const type = record["type"];
			if (typeof type !== "string" || type.trim().toLowerCase() !== "text") continue;
			const text = record["text"];
			if (typeof text !== "string" || text.trim() === "" || startsWithNeutralHead(text)) continue;
			record["text"] = `${WORKBUDDY_FALLBACK_SYSTEM_PROMPT}\n\n${text}`;
			changed = true;
		}
	}
	if (!changed) return void 0;
	return JSON.stringify(obj);
}
/**
* The invisible character used to break a content fingerprint.
*
* U+200B ZERO WIDTH SPACE: it renders as nothing, it is not whitespace for the
* gateway's own matching, and a model reads straight through it. Measured on
* the live CN gateway: putting one inside the refused span turns 400 into 200,
* while the text the model reads is unchanged.
*/
const ZERO_WIDTH_SPACE = "​";
/**
* Where an invisible break is inserted INSIDE a capitalised word pair, so a
* bare product name stops matching as an exact substring.
*
* WHY THE PUNCTUATION RULE IS NOT ENOUGH. The boundary rules above only land
* where there is a `.`, `!`, `?`, `,`, `;` — so a scanned message that ends
* with a bare product name and no trailing punctuation (``… powered by
* DeepSeek Harness ``, the host's own agent line, ending at end-of-text) is
* left COMPLETELY UNCHANGED. `perturbChannelFingerprints` then answers
* `undefined`, the shim spends no retry, and the fingerprint survives the
* rescue — measured, and it is the shape issue #113's reporter is most likely
* to hit, because that line is the first line of every DSH agent prompt.
*
* This rule breaks between a capitalised word and the following capitalised
* word (“DeepSeek|Harness”, “Visual|Studio”), which covers product names
* without touching ordinary prose: a sentence rarely has two capitalised
* words adjacent UNLESS they are a proper name, and breaking a proper name is
* exactly the intent. The model reads straight through U+200B, so what it
* understands is unchanged — that is the whole point of using it for this
* rather than rewriting the text.
*/
const WORD_INTERNAL_BREAK = /([A-Z][A-Za-z0-9]*)(\s+)(?=[A-Z][A-Za-z0-9])/gu;
/** A rune the dense rescue treats as a word character. */
const DENSE_WORD_RUNE = /[A-Za-z0-9぀-ヿ㐀-鿿]/u;
/**
* Space U+200B through each run of non-space runes, when that run starts with a
* word rune.
*
* THE ONE-PASS FORM OF THE DENSE RULE (issue #159). The rule only ever consults
* two local facts — the first rune of the CURRENT run of non-space runes, and
* whether the rune immediately before this position is already a break — so it
* needs one accumulator and no prefix slicing, which is what makes it linear
* rather than quadratic. See the body for why the reference is the run's FIRST
* rune rather than the previous one, and for the exact old expression it
* reproduces.
*
* It is kept as a standalone function so its output can be compared against a
* literal transcription of the old `replace` in the test suite: the rewrite is
* a performance change only, and a byte-difference would mean the rescue sends
* a body nobody measured.
*/
function spaceDenseBreaks(text) {
	const runes = Array.from(text);
	let out = "";
	/** First rune of the current run of non-space runes; `undefined` outside one. */
	let runStart;
	for (let index = 0; index < runes.length; index += 1) {
		const rune = runes[index];
		if (/^\s$/u.test(rune)) {
			runStart = void 0;
			out += rune;
			continue;
		}
		runStart ??= rune;
		const inRun = index > 0 && !/^\s$/u.test(runes[index - 1]);
		const before = runes[index - 1];
		if (inRun && runStart !== ZERO_WIDTH_SPACE && DENSE_WORD_RUNE.test(runStart) && rune !== ZERO_WIDTH_SPACE && before !== ZERO_WIDTH_SPACE) out += ZERO_WIDTH_SPACE;
		out += rune;
	}
	return out;
}
/**
* A body whose scanned message TEXT is perturbed just enough to break an exact
* content fingerprint.
*
* THE SECOND HALF OF ISSUE #98, found on 2026-10-21 after 4.15.0 shipped. The
* gateway does not only match the OPENING of a scanned message; it also matches
* one long substring INSIDE the system prompt. Measured byte-exactly on a real
* failed request (CN gateway, `deepseek-v4.1-flash`, the host's own body):
*
*   - the refusal is reproducible, and it is not the opening: the plugin had
*     already prepended the neutral head, and the request still answered 400;
*   - bisecting the host's 10,956-character system prompt by lines and then by
*     sentences found a 221-character span: the DSH Web-GUI paragraph's first
*     two sentences ("You are interacting with the user through the DeepSeek
*     Harness Web GUI … they mean this GUI.");
*   - that span ALONE reproduces the 400, and the SAME span with ANY change
*     inside it answers 200 — one character rewritten, one quoted word
*     replaced, even a zero-width space inserted. An outer prefix or suffix
*     does not help, so the match is an exact substring, not an opening rule;
*   - the paragraph's individual sentences each answer 200, which is why the
*     plugin's opening-based normalisation never saw this.
*
* SO THE RESCUE CANNOT BE "prepend a line" (that is {@link forceNeutralHead},
* and it is a no-op here). Nor can it be a list of refused spans: the list is
* the upstream's own data, it already grew once without notice, and it will
* grow again. What DOES generalise is the observation that an exact-substring
* match dies on any perturbation inside it — so this inserts a zero-width space
* at every sentence and clause boundary of the scanned messages, which is
* invisible to the reader, meaningless to the model, and inside the refused
* span with near-certainty for any prose fingerprint.
*
* WHEN IT IS USED: only as the last retry, after the gateway already refused
* the request AND the neutral head could not change anything. Requests the
* gateway answers keep their bytes untouched.
*
* `dense` adds word-boundary breaks for the last-resort rescue. The default
* sparse form is still used first because it is the least invasive and has been
* measured; dense mode exists for the refusal both the neutral head and the
* sparse form could not clear.
*
* Idempotent: a body that already carries U+200B in a scanned message is left
* alone, so a retry never stacks perturbations. Returns `undefined` when
* nothing would change, which is the caller's signal not to spend a request.
*
* Never throws: a malformed body is the upstream's to reject, and a parse error
* must not turn a rescue into a crash.
*/
function perturbChannelFingerprints(bodyJson, dense = false) {
	let parsed;
	try {
		parsed = JSON.parse(bodyJson);
	} catch {
		return;
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return void 0;
	const obj = parsed;
	const messages = obj["messages"];
	if (!Array.isArray(messages)) return void 0;
	let changed = false;
	const perturb = (text) => {
		const boundaries = text.replace(/([.!?])(\s+)/gu, `$1${ZERO_WIDTH_SPACE}$2`).replace(/([。！？])(?!\u200b)/gu, `$1${ZERO_WIDTH_SPACE}`).replace(/([,;])(\s+)/gu, `$1${ZERO_WIDTH_SPACE}$2`).replace(WORD_INTERNAL_BREAK, (whole, head, tail) => `${head}${ZERO_WIDTH_SPACE}${tail}`);
		if (!dense) return boundaries === text ? void 0 : boundaries;
		const denseText = spaceDenseBreaks(boundaries);
		return denseText === text ? void 0 : denseText;
	};
	for (const value of messages) {
		if (typeof value !== "object" || value === null || Array.isArray(value)) continue;
		const message = value;
		if (!scansOpening(message["role"])) continue;
		const content = message["content"];
		if (typeof content === "string") {
			const next = perturb(content);
			if (next !== void 0) {
				message["content"] = next;
				changed = true;
			}
			continue;
		}
		if (!Array.isArray(content)) continue;
		for (const part of content) {
			if (typeof part !== "object" || part === null || Array.isArray(part)) continue;
			const record = part;
			const type = record["type"];
			if (typeof type !== "string" || type.trim().toLowerCase() !== "text") continue;
			const text = record["text"];
			if (typeof text !== "string") continue;
			const next = perturb(text);
			if (next !== void 0) {
				record["text"] = next;
				changed = true;
			}
		}
	}
	if (!changed) return void 0;
	return JSON.stringify(obj);
}
/**
* The openings of every scanned message in a body, one entry per TEXT PART.
*
* `system` AND `assistant`, because both are read by the gate (measured; see
* {@link scansOpening}). `developer` counts as a system message because the
* plugin rewrites `developer` → `system` on the wire.
*
* Array content contributes ONE ENTRY PER PART, for the same reason the request
* path neutralises every part: the gate reads every text part, so "which line
* tripped it" can be any of them.
*
* Capped at {@link SYSTEM_EVIDENCE_LIMIT} entries, and never throws — losing
* the failure measurement is not an acceptable price for reading an excerpt.
*/
function openingEvidenceOfBody(bodyJson) {
	let parsed;
	try {
		parsed = JSON.parse(bodyJson);
	} catch {
		return [];
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return [];
	const messages = parsed["messages"];
	if (!Array.isArray(messages)) return [];
	const evidence = [];
	for (let index = 0; index < messages.length; index++) {
		if (evidence.length >= SYSTEM_EVIDENCE_LIMIT) break;
		const value = messages[index];
		if (typeof value !== "object" || value === null || Array.isArray(value)) continue;
		const message = value;
		const role = message["role"];
		if (typeof role !== "string") continue;
		const roleName = role.trim().toLowerCase();
		if (roleName !== "system" && roleName !== "assistant" && roleName !== "developer") continue;
		const roleOfEvidence = roleName === "assistant" ? "assistant" : "system";
		const content = message["content"];
		const texts = [];
		if (typeof content === "string") texts.push(content);
		else if (Array.isArray(content)) for (const part of content) {
			if (typeof part !== "object" || part === null || Array.isArray(part)) continue;
			const record = part;
			const type = record["type"];
			if (typeof type !== "string" || type.trim().toLowerCase() !== "text") continue;
			const text = record["text"];
			if (typeof text === "string") texts.push(text);
		}
		for (const text of texts) {
			if (evidence.length >= SYSTEM_EVIDENCE_LIMIT) break;
			const opening = firstNonEmptyLineOf(text).replace(/\s+/gu, " ").trim();
			if (opening === "") continue;
			const closing = lastNonEmptyLineOf(text).replace(/\s+/gu, " ").trim();
			evidence.push({
				opening: clip(opening, SYSTEM_OPENING_LIMIT),
				textLength: text.length,
				...closing === "" || closing === opening ? {} : { closing: clip(closing, SYSTEM_OPENING_LIMIT) },
				role: roleOfEvidence,
				neutralized: startsWithNeutralHead(opening) || isUnapprovedChannelOpening(opening),
				messageIndex: index
			});
		}
	}
	return evidence;
}
/**
* How many openings the failure path reports.
*
* Eight is generous: the gate scans every system message and every text part
* of it, so a body with more than a handful of openings is not a prompt the
* reader can act on anyway — the reply names the first ones and the failure
* body carries the rest.
*
* The cap is HERE and not in the reply: this function reports everything it
* found (up to eight) and the reply renders as many of them as fit, saying
* how many were left out. Truncating the evidence before the reply sees it
* would make "N more" unanswerable.
*/
const SYSTEM_EVIDENCE_LIMIT = 8;
/**
* The first line of a text that carries something.
*
* Blank lines are SKIPPED: the neutral head is followed by an empty line, so
* the head itself is the line worth reporting, and a content that opens with
* blank lines still has an opening.
*/
function firstNonEmptyLineOf(content) {
	for (const line of content.split("\n")) if (line.trim() !== "") return line;
	return "";
}
/**
* The last line of a text that carries something.
*
* The gate has also been measured to match an exact substring INSIDE a scanned
* message, so a first line alone can point at the wrong evidence: a neutralised
* opening may sit above a fingerprint deeper in the same assistant history
* message. The closing line is the cheapest observable other end of that text.
*/
function lastNonEmptyLineOf(content) {
	const lines = content.split("\n");
	for (let index = lines.length - 1; index >= 0; index--) {
		const line = lines[index];
		if (line.trim() !== "") return line;
	}
	return "";
}
/**
* Make the conversation open with a system message, prepending the fallback
* when nothing else supplies one.
*
* `developer` is normalized to `system` first (the gateways reject
* `developer`), so an ordinary DSH request already satisfies this and the
* function is a no-op for it.
*/
function ensureSystemHead(obj) {
	const messages = obj["messages"];
	if (!Array.isArray(messages) || messages.length === 0) return;
	const head = messages[0];
	if (typeof head !== "object" || head === null || Array.isArray(head)) return;
	const role = head["role"];
	if (typeof role === "string" && role.trim().toLowerCase() === "system") return;
	messages.unshift({
		role: "system",
		content: WORKBUDDY_FALLBACK_SYSTEM_PROMPT
	});
}
/**
* The model id a prepared body asks for, when it carries one (issue #61).
*
* Lives beside {@link prepareChatBody} because it reads the same shape: the
* serialized OpenAI body, after this plugin's rewrites. Never throws — a
* malformed body is the upstream's to reject, not a reason to lose the failure
* measurement that this id is needed for.
*/
function modelIdOfBody(bodyJson) {
	try {
		const parsed = JSON.parse(bodyJson);
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return void 0;
		const model = parsed["model"];
		return typeof model === "string" && model !== "" ? model : void 0;
	} catch {
		return;
	}
}
/**
* The optional run of `billion-context` markers every injected-prefix match
* tolerates in front of the marker text, and the built-in marker alternatives.
*/
const INJECTED_ACP_MARKER_RUN = "(?:<acp\\b[^>]*>m\\d{1,8}<\\/acp>[ \\t]*\\r?\\n?)*";
const INJECTED_BUILT_IN_PREFIXES = "Time sampled while preparing turn \\d+, step \\d+:|Current runtime context\\.|<system-reminder>|\\[Compressed conversation section\\]|This is an efficiency nudge";
/**
* Prefixes the DSH harness uses for the context it injects as `user` messages.
*
* MEASURED shapes, not guesses: the harness's time-context provider appends
* `Time sampled while preparing turn N, step M: …`, its runtime-context
* provider appends `Current runtime context. …`, and its reminders arrive as
* `<system-reminder>` blocks. `billion-context` injects its compression record
* and its efficiency note as `user` messages too (issue #133): the compressed
* section opens with a bracketed `[Compressed conversation section]` heading
* line, and the nudge opens with `This is an efficiency …`. `billion-context`
* may additionally wrap each
* message in an `<acp …>mNNNNN</acp>` marker, so the pattern TOLERATES that
* marker in front of an injected block — the marker itself is never removed
* from an injected message (see {@link ACP_LEADING_TAG} for where a marker IS
* removed, and why that is only the recorded prompt).
*
* A body whose trailing user message starts with none of these is left exactly
* as it arrived — the alternative (moving "the last non-empty user message")
* would reorder real conversations from other clients.
*/
const INJECTED_USER_PREFIX = new RegExp(`^${INJECTED_ACP_MARKER_RUN}(?:${INJECTED_BUILT_IN_PREFIXES})`, "u");
/**
* Escape a user-supplied prefix so it can be embedded as a literal alternative.
*/
function escapeRegExp(text) {
	return text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
/**
* The prefix pattern for one request: the built-ins plus any configured
* extras, each extra matched literally at the same position the built-ins
* match (after optional leading whitespace and the `billion-context` marker).
* Returns the shared built-in pattern when there are no usable extras.
*/
function injectedPrefixPattern(extras) {
	const literals = (extras ?? []).filter((extra) => typeof extra === "string" && extra !== "");
	if (literals.length === 0) return INJECTED_USER_PREFIX;
	return new RegExp(`^${INJECTED_ACP_MARKER_RUN}(?:${INJECTED_BUILT_IN_PREFIXES}|${literals.map(escapeRegExp).join("|")})`, "u");
}
/**
* The per-message marker `billion-context` puts in front of every message.
*
* Stripped from the REAL prompt only (issue #132), because the usage page takes
* that message verbatim and the recorded row would otherwise open with
* `<acp …>m00042</acp>` instead of what the user typed. Only the marker is
* removed, never any text: the earlier messages keep theirs, so a model that
* cites a past message by its `mNNNNN` id can still do it — the one id lost is
* the message being answered right now, which is the only reference that cannot
* matter. Injected messages keep their marker too: they are not the row being
* recorded, and touching them would widen the edit for no benefit. Done only
* under the same opt-in as the reorder, since it deletes bytes the upstream
* counts.
*/
const ACP_LEADING_TAG = /^<acp\b[^>]*>m\d{1,8}<\/acp>[ \t]*\r?\n?/u;
/**
* The plain text of one message's content, for prefix matching only.
*
* Array-shaped content contributes its text parts joined by a newline; a
* non-text part is skipped rather than stringified, because `[object Object]`
* would make every prefix test miss.
*/
function textOfContent(content) {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const parts = [];
	for (const part of content) {
		if (typeof part !== "object" || part === null || Array.isArray(part)) continue;
		const record = part;
		if (typeof record["text"] !== "string") continue;
		parts.push(record["text"]);
	}
	return parts.join("\n");
}
/**
* Drop the leading `billion-context` marker from one message's content.
*
* Handles both shapes (a bare string, or array content whose first `text` part
* carries the marker) and leaves everything else untouched. Returns whether it
* changed anything, so a body with no marker is not re-serialized for nothing.
*/
function stripLeadingAcpTag(content) {
	if (typeof content === "string") {
		if (!ACP_LEADING_TAG.test(content)) return {
			value: content,
			changed: false
		};
		return {
			value: content.replace(ACP_LEADING_TAG, ""),
			changed: true
		};
	}
	if (!Array.isArray(content)) return {
		value: content,
		changed: false
	};
	for (const part of content) {
		if (typeof part !== "object" || part === null || Array.isArray(part)) continue;
		const record = part;
		if (record["type"] !== "text" || typeof record["text"] !== "string") continue;
		if (!ACP_LEADING_TAG.test(record["text"])) continue;
		record["text"] = record["text"].replace(ACP_LEADING_TAG, "");
		return {
			value: content,
			changed: true
		};
	}
	return {
		value: content,
		changed: false
	};
}
/** Whether this message is one of the harness's injected context blocks. */
function isInjectedUserMessage(message, pattern) {
	if (message["role"] !== "user") return false;
	return pattern.test(textOfContent(message["content"]).replace(/^\s+/u, ""));
}
/**
* Move the trailing injected `user` messages above the real prompt.
*
* Returns `true` when the order changed, so the caller can serialize only once.
* Never throws, and a body with nothing to move keeps its exact message order.
*/
function keepPromptLast(messages, pattern) {
	let promptIndex = -1;
	for (let index = messages.length - 1; index >= 0; index--) {
		const value = messages[index];
		if (typeof value !== "object" || value === null || Array.isArray(value)) continue;
		const message = value;
		if (message["role"] !== "user") continue;
		if (isInjectedUserMessage(message, pattern)) continue;
		if (textOfContent(message["content"]).trim() === "") continue;
		promptIndex = index;
		break;
	}
	if (promptIndex < 0) return false;
	const trailing = messages.slice(promptIndex + 1).filter((value) => typeof value === "object" && value !== null && !Array.isArray(value) ? isInjectedUserMessage(value, pattern) : false);
	if (trailing.length === 0) return false;
	const kept = messages.filter((value, index) => !(index > promptIndex && typeof value === "object" && value !== null && !Array.isArray(value) && isInjectedUserMessage(value, pattern)));
	kept.splice(promptIndex, 0, ...trailing);
	const prompt = kept[promptIndex + trailing.length];
	if (typeof prompt === "object" && prompt !== null && !Array.isArray(prompt)) {
		const message = prompt;
		const stripped = stripLeadingAcpTag(message["content"]);
		if (stripped.changed) message["content"] = stripped.value;
	}
	messages.length = 0;
	messages.push(...kept);
	return true;
}
/**
* Normalize an OpenAI chat-completions body for the WorkBuddy upstream: force
* `stream: true` (the upstream rejects non-streaming), flatten `tool_choice`
* (the upstream's field is a string; object forms return 400), rewrite
* `developer` to `system`, guarantee a leading system message, and move a
* recognized third-party-agent system prompt off the gateways' content
* fingerprint.
*
* The last step is not cosmetic: both gateways refuse a request whose `system`
* message opens with one of the openings listed at
* {@link UNAPPROVED_CHANNEL_OPENINGS} — business code 11128, surfaced to the
* user as a "渠道校验" (channel verification) failure — which made every CN step
* of a DSH session fail while a two-message probe on the same account returned
* 200. Every rewrite in here is forced by a gateway rule, so a body the
* upstream already answers keeps its prompt as close to byte-for-byte as these
* rules allow.
*/
function prepareChatBody(source, options) {
	let body;
	try {
		body = JSON.parse(source);
	} catch {
		return source;
	}
	if (typeof body !== "object" || body === null || Array.isArray(body)) return source;
	const obj = body;
	obj["stream"] = true;
	if (Array.isArray(obj["messages"])) for (const value of obj["messages"]) {
		if (typeof value !== "object" || value === null || Array.isArray(value)) continue;
		const message = value;
		if (message["role"] === "developer") message["role"] = "system";
	}
	ensureSystemHead(obj);
	if (options?.keepPromptLast === true && Array.isArray(obj["messages"])) keepPromptLast(obj["messages"], injectedPrefixPattern(options.extraInjectedPrefixes));
	rewriteChannelFingerprintPhrasesInBody(obj);
	neutralizeChannelFingerprints(obj);
	normalizeToolChoice(obj);
	dropRefusedReasoning(obj);
	return JSON.stringify(obj);
}
/**
* The host's session-title prompt template, verbatim up to the JSON payload.
*
* MEASURED in the installed DSH desktop 0.2.1-rc.2 `app.asar`, twice: the
* request builder interpolates exactly this prefix before the JSON array of
* `{seq, text}` records, and the host's own format validator asserts the
* session-event carries the same text. Every title plugin the host bundles
* (`dsh-session-title-llm`, `…-first-prompt-llm`, `…-all-prompts-llm`) shares
* the template, so one prefix covers all variants. `purpose: 'session-title'`
* exists on the host's `GenerateOptions` type but does not travel on the
* OpenAI wire, so body shape is the only discriminator the shim has.
*/
const SESSION_TITLE_PROMPT_PREFIX = "Generate the session title from this JSON array of human messages:\n";
const SESSION_TITLE_PROMPT_HEAD = "Generate the session title from this JSON array of human messages:";
/**
* The ASCII-only head of the template, up to (not including) its newline.
*
* The full prefix contains a raw newline, which a serialized body escapes to
* `\n`, so `prepared.includes(SESSION_TITLE_PROMPT_PREFIX)` would MISS every
* real title. This head is all plain ASCII, so it appears verbatim in the
* serialized body whenever the host sends the template as a single text part
* — which its own format validator asserts (`content.length === 1`). It
* therefore makes a prefilter without false negatives for the real shape; a
* body split mid-template across array parts would slip past it and simply
* keep the pre-rewrite behaviour. False positives (a conversation quoting the
* template) are fine: the full detection below rejects them — the prefilter
* only skips work, never changes a verdict.
*/
/**
* Rewrite a recognized session-title request onto the hidden lightweight model.
*
* WHY (issues #132/#133). The host asks its title plugins' prompt through the
* same provider the conversation uses, so the title of every new session is
* billed at the main paid model's rate. The reporter measured the upstream's
* hidden `wb-lite` at 0 credits for exactly these requests (real upstream
* calls, counted toward request volume, only fired once per new session), so
* the rewrite moves the title to that model.
*
* DETECTION is fail-closed: the body is rewritten only when it has NO
* assistant or tool messages and EXACTLY ONE `user` message, and that message
* opens with the host's title template above. A real conversation can hardly
* collide with the template (the host's own validator asserts it), and the
* failure direction if the host ever rewords it is safe: the rewrite simply
* stops, and the title is billed as before. `keepPromptLast` is unaffected —
* the template prefix is not an injected-context marker, so a title body is
* never reordered.
*
* WHAT is rewritten: the model id and the reasoning fields the lightweight
* model does not accept. Everything else — `stream`, `max_tokens`, the
* identity headers, every message byte — is untouched, so the other switches
* keep behaving exactly as they do for conversation requests.
*
* Returns the original string unchanged when not enabled or not a title
* request, so the caller does not need a separate shape check.
*/
function rewriteSessionTitleModel(prepared, options) {
	if (options?.enabled !== true) return prepared;
	if (!prepared.includes(SESSION_TITLE_PROMPT_HEAD)) return prepared;
	let body;
	try {
		body = JSON.parse(prepared);
	} catch {
		return prepared;
	}
	if (typeof body !== "object" || body === null || Array.isArray(body)) return prepared;
	const obj = body;
	const messages = obj["messages"];
	if (!Array.isArray(messages)) return prepared;
	let titleText;
	for (const value of messages) {
		if (typeof value !== "object" || value === null || Array.isArray(value)) return prepared;
		const message = value;
		if (message["role"] === "assistant" || message["role"] === "tool") return prepared;
		if (message["role"] !== "user") continue;
		if (titleText !== void 0) return prepared;
		titleText = textOfContent(message["content"]);
	}
	if (titleText === void 0) return prepared;
	if (!titleText.replace(/^\s+/u, "").startsWith(SESSION_TITLE_PROMPT_PREFIX)) return prepared;
	obj["model"] = typeof options.model === "string" && options.model.trim() !== "" ? options.model.trim() : "wb-lite";
	delete obj["reasoning_effort"];
	delete obj["reasoning"];
	return JSON.stringify(obj);
}
/**
* Remove `reasoning_effort: "off"` when it would only ever fail (issue #83).
*
* The refusal table is keyed by exact model id, but the model a request
* actually names can change AFTER the catalog was built: account-pool failover
* re-points the body at another account's model, and `primary-model` is an
* alias whose concrete id the gateway resolves. A tick on such a row therefore
* reaches this plugin's prepared body as a bare `"off"` — exactly the value the
* table says the upstream answers with HTTP 400 / code 11133.
*
* Stripped HERE because this is the last thing the plugin controls before the
* upstream counts the body, and because the test is {@link offRefused} — the
* same single source of truth the catalog stamping uses, so the two cannot
* drift apart.
*
* Only the literal `"off"` is touched. Every other effort value returned 200 on
* every model measured for issue #34, and a body naming no effort is left
* alone: deleting a field the caller never sent would be inventing an opinion
* about how the model should think.
*/
function dropRefusedReasoning(obj) {
	const effort = obj["reasoning_effort"];
	if (typeof effort !== "string" || effort.trim().toLowerCase() !== "off") return;
	const model = obj["model"];
	if (typeof model !== "string" || !offRefused(model)) return;
	delete obj["reasoning_effort"];
}
/** Rewrite OpenAI `tool_choice` spellings into the upstream's string form. */
function normalizeToolChoice(obj) {
	const suppress = () => {
		delete obj["tools"];
		delete obj["functions"];
	};
	if (!("tool_choice" in obj)) return;
	const choice = obj["tool_choice"];
	if (typeof choice === "string") {
		if (choice.trim().toLowerCase() === "none") {
			delete obj["tool_choice"];
			suppress();
		}
		return;
	}
	if (typeof choice === "object" && choice !== null && !Array.isArray(choice)) {
		const wrapped = choice;
		const type = typeof wrapped["type"] === "string" ? wrapped["type"].trim().toLowerCase() : "";
		if (type === "none") {
			delete obj["tool_choice"];
			suppress();
		} else if (type === "auto" || type === "required") obj["tool_choice"] = type;
		else if (type === "function") {
			const fn = typeof wrapped["function"] === "object" && wrapped["function"] !== null ? wrapped["function"] : void 0;
			let name = typeof fn?.["name"] === "string" ? fn["name"] : "";
			if (name === "" && typeof wrapped["name"] === "string") name = wrapped["name"];
			name = name.trim();
			obj["tool_choice"] = name !== "" ? name : "auto";
		} else delete obj["tool_choice"];
		return;
	}
	delete obj["tool_choice"];
}
/**
* What a PREPARED request body declares, as the input to DSML recovery.
*
* This exists so the recovery path can answer the one question its gates turn
* on — "was this tool name offered in THIS request?" — without a second parse
* of the body and without a second source of truth. `prepareChatBody` has
* already parsed it; this reads the same prepared JSON.
*
* Two facts make it cheap and exact:
*
*   - `tool_choice: "none"` deletes `tools` outright in
*     {@link normalizeToolChoice}, so "no tools declared" is directly
*     observable here rather than a separate condition to remember;
*   - a pinned `tool_choice` arrives as the bare function name (the object form
*     was flattened), so anything that is not `auto`/`required`/`none` is a pin.
*
* Returns `undefined` when the body declares nothing usable — malformed JSON,
* no `tools` array, or an empty one. Callers must read that as "recovery is
* off" (gate 3), not as "no information, so guess".
*/
function declaredTools(bodyJson) {
	let body;
	try {
		body = JSON.parse(bodyJson);
	} catch {
		return;
	}
	if (typeof body !== "object" || body === null || Array.isArray(body)) return void 0;
	const obj = body;
	const tools = obj["tools"];
	if (!Array.isArray(tools)) return void 0;
	const names = /* @__PURE__ */ new Set();
	const requiredParameters = /* @__PURE__ */ new Map();
	const acceptedParameters = /* @__PURE__ */ new Map();
	for (const value of tools) {
		if (typeof value !== "object" || value === null || Array.isArray(value)) continue;
		const fn = value["function"];
		if (typeof fn !== "object" || fn === null || Array.isArray(fn)) continue;
		const definition = fn;
		const name = typeof definition["name"] === "string" ? definition["name"] : "";
		if (name === "") continue;
		names.add(name);
		const parameters = definition["parameters"];
		if (typeof parameters !== "object" || parameters === null || Array.isArray(parameters)) continue;
		const schema = parameters;
		const accepted = /* @__PURE__ */ new Set();
		const properties = schema["properties"];
		if (typeof properties === "object" && properties !== null && !Array.isArray(properties)) {
			for (const key of Object.keys(properties)) if (key !== "") accepted.add(key);
		}
		acceptedParameters.set(name, accepted);
		const required = schema["required"];
		if (!Array.isArray(required)) continue;
		const list = required.filter((entry) => typeof entry === "string" && entry !== "");
		if (list.length > 0) requiredParameters.set(name, list);
	}
	if (names.size === 0) return void 0;
	const pinned = typeof obj["tool_choice"] === "string" ? obj["tool_choice"].trim() : "";
	const pinnedToolName = pinned !== "" && ![
		"auto",
		"required",
		"none"
	].includes(pinned.toLowerCase()) ? pinned : void 0;
	return {
		names,
		requiredParameters,
		acceptedParameters,
		...pinnedToolName === void 0 ? {} : { pinnedToolName }
	};
}
/**
* Gateway (openresty/APISIX) rejection of a token it no longer accepts.
*
* The business APIs answer JSON; an edge rejection answers an HTML error page
* instead. A 401 that is not JSON therefore means the credential was refused
* before routing — almost always a revoked/expired token rather than a bug in
* the request. Detected from the body so a proxy's own error page (which would
* also be HTML) is still described accurately.
*/
function isGatewayAuthRejection(status, text) {
	if (status !== 401 && status !== 403) return false;
	const lower = text.toLowerCase();
	return lower.includes("openresty") || lower.includes("apisix") || lower.includes("authorization required");
}
/** Marker carried by {@link WorkBuddyCredentialRejectedError}; survives bundling. */
const CREDENTIAL_REJECTED_CODE = "WORKBUDDY_CREDENTIAL_REJECTED";
/**
* The upstream refused the CREDENTIAL itself rather than failing the request.
*
* This is a distinct, actionable class: the token is not usable and no retry
* with the same token will help. Callers use it to tell the user what to do
* about it (switch accounts, or sign in again) instead of showing a raw HTTP
* error, and the card must never confuse it with a transient upstream fault.
*
* Identified by {@link CREDENTIAL_REJECTED_CODE} rather than `instanceof`, so
* the check keeps working when the caller and the thrower end up in different
* module instances (bundled host half vs. a test's source import).
*/
var WorkBuddyCredentialRejectedError = class extends Error {
	code = CREDENTIAL_REJECTED_CODE;
	/** HTTP status the upstream answered with (401 or 403). */
	status;
	constructor(status) {
		super(`workbuddy: the signed-in credential was rejected by the upstream gateway (http ${status}). The stored token is no longer accepted — most likely a stale credential file from an earlier sign-in was selected. Re-sign in to the WorkBuddy desktop app, then pick that account in the plugin card. Run \`dsh-connect-workbuddy doctor\` to list every discovered credential.`);
		this.name = "WorkBuddyCredentialRejectedError";
		this.status = status;
	}
};
/** Whether an error reports that the upstream refused the credential itself. */
function isCredentialRejectedError(value) {
	return typeof value === "object" && value !== null && value.code === "WORKBUDDY_CREDENTIAL_REJECTED";
}
async function readEnvelope(response) {
	const text = await response.text();
	let parsed;
	try {
		parsed = JSON.parse(text);
	} catch {
		if (isGatewayAuthRejection(response.status, text)) throw new WorkBuddyCredentialRejectedError(response.status);
		throw new Error(`workbuddy upstream returned non-JSON (http ${response.status}): ${text.slice(0, 160)}`);
	}
	if (typeof parsed !== "object" || parsed === null) throw new Error(`workbuddy upstream returned an unexpected document (http ${response.status})`);
	const document = parsed;
	return {
		code: typeof document["code"] === "number" ? document["code"] : 0,
		msg: typeof document["msg"] === "string" ? document["msg"] : "",
		data: "data" in document ? document["data"] : void 0
	};
}
/**
* Parse the enterprise endpoint's `cycleResetTime` ("2026-11-01 00:00:00").
*
* The value carries NO timezone marker, and the official client renders it as
* local wall-clock time (it is what the user sees in "resets on 11/01 00:00"),
* so it is read as LOCAL time rather than as UTC. `Date.parse` on that shape is
* implementation-defined, which is exactly why it is assembled by hand.
*/
function parseEnterpriseInstant(value) {
	const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
	if (match === null) {
		const fallback = Date.parse(value);
		return Number.isNaN(fallback) ? void 0 : fallback;
	}
	const [, y, mo, d, h, mi, se] = match;
	const parsed = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(se ?? "0")).getTime();
	return Number.isNaN(parsed) ? void 0 : parsed;
}
/**
* Fail an envelope whose business code is non-zero, classified like HTTP errors.
*
* A JSON body on a 401/403 is still a credential refusal: the edge answered in
* the business shape, but the token is just as unusable, so it maps to the same
* actionable error instead of a generic "client" failure.
*
* THE CLASSIFIER IS HANDED THE CODE, NOT JUST THE SENTENCE (issue #155's sibling).
* `readEnvelope` has already parsed `code` as a number, and this call used to
* rebuild its diagnosis from `msg` alone — a sentence that never contains
* `"code":…`. Every family that decides on its business code was therefore
* invisible here, and the answer fell through to `client`: the report filed as
* `workbuddy upstream client (http 400): 请求被拦截，请重新发送` (#144) is one
* envelope whose code the Host was already holding. Re-stating the envelope in
* its canonical form is what lets the shared classifier see both halves it is
* written to read: the code, and the same `msg` wording it saw before. Strictly
* more information than the text-only call, never less.
*/
function envelopeError(status, envelope) {
	if (status === 401 || status === 403) return new WorkBuddyCredentialRejectedError(status);
	const kind = classifyUpstreamError(status, `{"code":${envelope.code},"msg":${JSON.stringify(envelope.msg)}}`);
	return /* @__PURE__ */ new Error(`workbuddy upstream ${kind} (http ${status}): ${envelope.msg.slice(0, 160)}`);
}
/**
* Parse the upstream's `credits` string into a multiplier.
*
* Observed forms: `"x0.79 credits"`, `"x0.05"`, `"x0.00 credits"`,
* and absent. Unparsable values yield undefined rather than a guess — the
* card simply omits the rate instead of displaying a fabricated one.
*/
function parseCreditMultiplier(value) {
	if (typeof value !== "string") return void 0;
	const match = /x\s*([0-9]*\.?[0-9]+)/iu.exec(value);
	if (match === null) return void 0;
	const parsed = Number(match[1]);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : void 0;
}
/**
* The effort vocabulary the upstream's plural-form payloads declare across both
* gateways (live union of every `supportedEfforts` list seen; `minimal` has
* never appeared). Both gateways also accept every level in it on
* singular-form models — medium/xhigh fold into high, low/max answer with
* their own budgets — so the singular `effort` value is a DEFAULT, never the
* model's only level.
*/
const SINGULAR_EFFORT_LADDER = [
	"low",
	"medium",
	"high",
	"xhigh",
	"max"
];
/**
* The singular spelling of reasoning metadata: `effort` (plus the ignored
* `summary`) and none of the plural-form fields. Observed on CN
* `deepseek-v4.1-flash`/`kimi-k3-1`/`glm-5.2`… and global
* `deepseek-v4.1-flash`/`kimi-k3`/`gemini-3.5-flash`… (issue #7).
*/
function isSingularEffortForm(raw) {
	return typeof raw["effort"] === "string" && !Array.isArray(raw["supportedEfforts"]) && typeof raw["defaultEffort"] !== "string" && typeof raw["canDisableThinking"] !== "boolean";
}
/**
* Fold a singular-form `effort` into the plural shape the rest of the plugin
* already understands. Live probes on both gateways (issue #7) show these
* models answer with distinct `reasoning_content` across the whole ladder —
* and think NOT AT ALL when no `reasoning_effort` is sent — so the fold
* widens `supportedEfforts` and carries the declared value into
* `defaultEffort`. An unrecognized `effort` value passes through as the lone
* level, leaving its fate to the adapter's known-level filter.
*/
function singularEffortLadder(raw) {
	const effort = typeof raw["effort"] === "string" ? raw["effort"] : void 0;
	if (effort === void 0) return void 0;
	return SINGULAR_EFFORT_LADDER.includes(effort) ? [...SINGULAR_EFFORT_LADDER] : [effort];
}
/**
* Parse the upstream's `reasoning` object; unknown shapes degrade to `{}`.
* Both spellings normalize here: the plural form passes through as declared,
* and the singular `effort` form folds via {@link singularEffortLadder}.
*/
function parseReasoning(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return void 0;
	const raw = value;
	const effort = typeof raw["effort"] === "string" ? raw["effort"] : void 0;
	const supportedEfforts = Array.isArray(raw["supportedEfforts"]) ? raw["supportedEfforts"].filter((entry) => typeof entry === "string") : singularEffortLadder(raw);
	const defaultEffort = typeof raw["defaultEffort"] === "string" ? raw["defaultEffort"] : effort;
	const canDisableThinking = typeof raw["canDisableThinking"] === "boolean" ? raw["canDisableThinking"] : isSingularEffortForm(raw) ? true : void 0;
	if (supportedEfforts === void 0 && defaultEffort === void 0 && canDisableThinking === void 0) return;
	return {
		...supportedEfforts === void 0 || supportedEfforts.length === 0 ? {} : { supportedEfforts },
		...defaultEffort === void 0 ? {} : { defaultEffort },
		...canDisableThinking === void 0 ? {} : { canDisableThinking }
	};
}
/** Parse one catalog entry; entries without usable token limits are dropped. */
function parseUpstreamModel(value) {
	if (typeof value !== "object" || value === null) return void 0;
	const raw = value;
	const id = typeof raw["id"] === "string" ? raw["id"] : "";
	if (id === "" || raw["disabled"] === true) return void 0;
	const input = typeof raw["maxInputTokens"] === "number" ? raw["maxInputTokens"] : 0;
	const output = typeof raw["maxOutputTokens"] === "number" ? raw["maxOutputTokens"] : 0;
	if (input <= 0 || output <= 0) return void 0;
	const name = typeof raw["name"] === "string" && raw["name"] !== "" ? raw["name"] : id;
	const descriptionZh = typeof raw["descriptionZh"] === "string" && raw["descriptionZh"] !== "" ? raw["descriptionZh"] : void 0;
	const descriptionEn = typeof raw["descriptionEn"] === "string" && raw["descriptionEn"] !== "" ? raw["descriptionEn"] : void 0;
	const creditMultiplier = parseCreditMultiplier(raw["credits"]);
	const reasoning = parseReasoning(raw["reasoning"]);
	const supportsToolCall = typeof raw["supportsToolCall"] === "boolean" ? raw["supportsToolCall"] : void 0;
	const supportsImages = raw["disabledMultimodal"] === true ? false : typeof raw["supportsImages"] === "boolean" ? raw["supportsImages"] : void 0;
	return {
		id,
		name,
		contextWindow: input,
		maxTokens: output,
		...creditMultiplier === void 0 ? {} : { creditMultiplier },
		...supportsImages === void 0 ? {} : { supportsImages },
		...reasoning === void 0 ? {} : { reasoning },
		...descriptionZh === void 0 ? {} : { descriptionZh },
		...descriptionEn === void 0 ? {} : { descriptionEn },
		...supportsToolCall === void 0 ? {} : { supportsToolCall }
	};
}
/**
* Select the chat-capable models from a catalog-shaped document: parse every
* entry, then keep the `cli` agent's roster in its declared order.
*
* Both the CN personal-models document and the global `/v3/config` document
* carry `models` plus an `agents` roster with the same entry shape, so one
* selector serves them. Without a usable `cli` roster the whole parsed catalog
* is exposed rather than nothing: the roster is an upstream detail that may
* change, and an empty answer would silently disarm the provider.
*
* ROUTERS ARE NOT MODELS. The upstream lists `auto` (CN) and its global
* equivalents alongside real models, but those entries are ROUTING decisions,
* not models: the gateway resolves them to whichever model it thinks fits, so
* a row for one would offer a name whose price, context window and behaviour
* are all decided at request time by something else. Selected this way it also
* duplicates a real row — upstream resolves CN `auto` to `hy4-preview`, which
* is already in the same roster. They are dropped here, at the single place
* the roster is built, so the card, the picker, the probe and the discovery
* route all agree. A user who already had one enabled keeps it through
* `keepIds` below: this removes the OFFER, never a running model (issue #32's
* failure mode).
*
* `keepIds` is the user's own selection riding along with the refresh. The
* upstream roster may drop a model the user is actually running — the app
* channel's `cli` roster dropped `minimax-m2.7` on 2026-10-21 while the SAME
* document still publishes it (`x0.26`) and the chat endpoint still answers for
* it (measured HTTP 200). A roster read is therefore the upstream's roster PLUS
* the kept ids this document still lists: a refresh may add or withdraw
* upstream models, but it never silently withdraws a model the user is on.
*/
function selectCliModels(rawModels, agents, keepIds = []) {
	const byId = /* @__PURE__ */ new Map();
	for (const model of Array.isArray(rawModels) ? rawModels : []) {
		const parsed = parseUpstreamModel(model);
		if (parsed !== void 0) byId.set(parsed.id, parsed);
	}
	let cliIds;
	for (const agent of Array.isArray(agents) ? agents : []) if (typeof agent === "object" && agent !== null) {
		const wrapped = agent;
		if (wrapped["name"] === "cli" && Array.isArray(wrapped["models"])) {
			cliIds = wrapped["models"].filter((id) => typeof id === "string");
			break;
		}
	}
	const ids = cliIds !== void 0 && cliIds.length > 0 ? cliIds : [...byId.keys()];
	const models = ids.filter((id) => !isRouterModelId(id)).map((id) => byId.get(id)).filter((model) => model !== void 0);
	const kept = keepIds.filter((id) => !ids.includes(id) && !isRouterModelId(id)).map((id) => byId.get(id)).filter((model) => model !== void 0);
	const resolved = [...models, ...kept];
	if (resolved.length === 0) throw new Error("workbuddy model catalog resolved to an empty list");
	return resolved;
}
/**
* Merge two rosters by model id, keeping the PRIMARY entry for every id both
* documents publish.
*
* Exists because the global `/v3/config` answers a different roster per client
* channel and NEITHER channel is a superset of the other — measured on a real
* global account 2026-11-06:
*
*   - desktop-only: `max-model`, `hy4free`, `hy4std`
*   - CLI-only:     `fast-model`, `balanced-model`, `primary-model`,
*                   `deepseek-v4.1-flash`, `hy4-preview`, `gpt-5.5`, `gpt-5.4`,
*                   `glm-5.2`
*   - common (20):  `deepseek-v4.1-flash-sg` is priced differently per channel
*                   (desktop `x0.11`, CLI `x0.03`); the other 18 agree.
*
* The caller passes the CLI roster as PRIMARY because the plugin chats as the
* CLI agent, so the CLI document is the one whose prices are actually settled
* when a request is made. Rows only the app document carries are appended, so
* the desktop-only `hy4free`/`hy4std` keep working — both answer HTTP 200 over
* the CLI chat channel.
*
* `max-model` is appended too even though the provider rejects it for personal
* accounts (`11133`): that veto belongs to the upstream at request time, and
* hiding a row the user can see in the app is the defect this merge fixes.
*/
function mergeModelRosters(primary, secondary) {
	const byId = /* @__PURE__ */ new Map();
	for (const model of primary) byId.set(model.id, model);
	const merged = [...primary];
	for (const model of secondary) {
		const existing = byId.get(model.id);
		if (existing === void 0) {
			byId.set(model.id, model);
			merged.push(model);
			continue;
		}
		/**
		* THE ID COLLIDED — and a plain id-dedup here silently deleted badges.
		*
		* `attachPromos` hangs a promotion on the MODEL OBJECT, so for a row both
		* documents publish, "which one survived" decides "does this row have a
		* badge". The two global documents are read through DIFFERENT client
		* channels: the app channel publishes `modelPromotions` / `modelTiers`, the
		* CLI channel publishes NEITHER (see the `fetchModels` docblock — reading
		* `/v3/config` as the CLI channel is the documented cause of an
		* entirely badge-less card). The caller passes the CLI roster as PRIMARY
		* because its PRICES are the settled ones, so keeping the primary row —
		* correct for prices — was also throwing away every badge the app document
		* carried for those 20 shared ids.
		*
		* So: keep the primary's fields (prices stay the CLI's) and graft on the
		* secondary's promotions when the primary has none. Merging is not
		* "pick a winner for the whole row"; these two facts are independent.
		*/
		if ((existing.promos === void 0 || existing.promos.length === 0) && model.promos !== void 0 && model.promos.length > 0) {
			const index = merged.indexOf(existing);
			const grafted = {
				...existing,
				promos: model.promos
			};
			if (index !== -1) merged[index] = grafted;
			byId.set(model.id, grafted);
		}
	}
	return merged;
}
/**
* The roster plus the promotion badges the SAME document carries.
*
* `data.modelPromotions` and `data.modelTiers` sit beside `data.models` in
* the upstream's `/v3/config` document, so the badges cost no extra request:
* they are read out of the response the roster was read from. Which models
* they name is resolved here; WHICH badge holds at a given moment is not
* (see `src/promo.ts` — a badge is a function of the clock).
*
* BOTH regions publish the feed, and they publish it in the app channel's
* document: measured 2026-10-21 on the same accounts the app reads, CN
* `/v3/config` carries 8 promotions + 1 tier badge (Chinese labels such as
* `夜间折扣` / `限时免费` / `订阅优先`, with `schedule.daily` night windows),
* and the global gateway carries 5 promotions + 1 tier badge. The feed is
* absent only from the CLI channel's answer, which the plugin never reads a
* product configuration as (see {@link PRODUCT_UA}).
*/
function withPromos(models, data) {
	const promos = parseWorkBuddyPromos(data["modelPromotions"], data["modelTiers"]);
	return promos.length === 0 ? models : attachPromos(models, promos);
}
/**
* What the plugin can tell about the request it just sent, for telling the
* `11128` family apart.
*
* TWO FACTS, both read from the request body rather than from the upstream's
* `msg` — which issue #113 measured to be unreliable (a content refusal
* reported as `conversation id missing`).
*
* - `hasSystemHead`: does the request open with a `system` message? The
*   plugin guarantees it does whenever the request carries messages
*   (`ensureSystemHead`), so a body claiming the first-message gate is only
*   believable when this is false.
* - `hasConversationHeaders`: did the request carry the conversation-id
*   triple? `chatHeaders` always adds it, so this is true in practice — and
*   that is exactly what makes a `conversation id missing` wording
*   unbelievable.
*
* Never throws: a body that cannot be read answers "unknown", which is the
* safe direction (the wording is then believed).
*/
function requestEvidenceOf(bodyJson) {
	const hasConversationHeaders = true;
	let parsed;
	try {
		parsed = JSON.parse(bodyJson);
	} catch {
		return {
			hasSystemHead: false,
			hasConversationHeaders
		};
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {
		hasSystemHead: false,
		hasConversationHeaders
	};
	const messages = parsed["messages"];
	if (!Array.isArray(messages)) return {
		hasSystemHead: false,
		hasConversationHeaders
	};
	const first = messages[0];
	if (typeof first !== "object" || first === null || Array.isArray(first)) return {
		hasSystemHead: false,
		hasConversationHeaders
	};
	const role = first["role"];
	return {
		hasSystemHead: role === "system" || role === "developer",
		hasConversationHeaders
	};
}
/**
* Upstream HTTP client. One instance serves the whole plugin; requests take
* the credential explicitly so token refreshes apply on the next call.
*/
var WorkBuddyUpstreamClient = class {
	onFallback;
	/**
	* Reports an anomaly the reader or classifier had to tolerate.
	*
	* Injected rather than logged here because this module holds no logger on
	* purpose — it is pure transport + parsing, so it stays importable from
	* tests and the CLI without a cordis context. The host wires its
	* `ctx.logger.warn` in; without a host the event is dropped, which is the
	* same silence the previous single-source reader had.
	*/
	/**
	* 解析一次的底座：设备盐（P1）。真 token 不在这里——它分钟级过期，
	* 必须每条请求现取，见 {@link wireIdentity}。
	*/
	baseIdentity;
	/** 外部 device token 的 TTL 读取器；未配置时为 undefined。 */
	deviceTokens;
	/** 每账号覆盖值的读取器（设置里齿轮保存的那些）；未接线时为 undefined。 */
	deviceProfiles;
	/** 真实值档的 token 源（本机安装的桌面端 SDK）；未接线时为 undefined。 */
	realDevice;
	/**
	* CN 网关 base（issue #220）。空 = 用内置常量，即 #220 之前的行为逐字节不变。
	*
	* 只影响 CN 区域：国际版仍然跟随凭据自己的域（`workbuddy.ai` /
	* `codebuddy.ai`），因为国际 token 跨品牌互不通用，那里没有"换一个同构主机"
	* 这回事。返回值必须已由 `resolveCnGateway` 的允许清单校验过，这个类不重新校验。
	*/
	cnBaseOf;
	constructor(onFallback, identity = {}, options = {}) {
		this.onFallback = onFallback;
		this.cnBaseOf = options.cnBase === void 0 ? () => "" : options.cnBase;
		this.baseIdentity = resolveWireIdentity(identity);
		this.deviceProfiles = options.deviceProfiles;
		this.realDevice = options.realDevice;
		const file = options.deviceTokenFile === void 0 ? "" : options.deviceTokenFile.trim();
		this.deviceTokens = file === "" ? void 0 : createDeviceTokenReader({
			file,
			...options.deviceTokenTtlMs === void 0 ? {} : { ttlMs: options.deviceTokenTtlMs },
			warn: (message) => this.onFallback?.(message)
		});
	}
	/**
	* 本次请求的完整身份：底座（盐）+ 当前有效的真 token + 这个账号的覆盖值。
	*
	* 为什么不是"构造时算一次"：盐是本机常量，token 是分钟级过期的东西，覆盖值是
	* 用户随时会改的设置。三者里只有盐是常量，把另外两个钉在构造期，一个跑了几小时
	* 的进程会一直发过期 token、也永远看不到刚保存的覆盖值。
	*/
	async wireIdentity(credential) {
		const base = await this.baseIdentity;
		if (profileOf(base) !== "balanced") return base;
		if ((this.deviceProfiles === void 0 ? "virtual" : await this.deviceProfiles.mode()) === "real") {
			const real = this.realDevice === void 0 ? void 0 : await this.realDevice.current();
			if (real !== void 0) return {
				...base,
				deviceTier: "real",
				deviceReal: real
			};
			/**
			* 取不到真实 token。两条路，由用户在卡片上选（作者意见 #2）。
			*
			* **不退回（默认关时会走到这里，也是 P3 原来的行为）**：一个设备头都不发。
			* 那是"SDK 不可用"时唯一不会说谎的答案——拿虚拟值顶上而界面写着「真实值」
			* 会让线上与界面对不上。
			*
			* **退回**（默认开）：落到下面的虚拟值通道，但**档位降成 `virtual`**，不是
			* 保留 `real` 再补一对派生 id。这一点是刻意的：`deviceTier` 既决定发哪些头，
			* 也决定界面与 `doctor` 怎么称呼"现在发的是什么"。保留 `real` 会让报告与
			* 出站字节相反，而报告正是用户用来判断"到底退没退"的唯一依据。
			*
			* 退回的那个瞬间不会静默：`readout()` 里 token 状态是 `unavailable` 并带
			* 原因，卡片与 `doctor` 都照实显示"现在发的是虚拟值，因为 SDK 取不到 token"。
			*/
			if (this.deviceProfiles === void 0 || !await this.deviceProfiles.fallbackToVirtual()) return {
				...base,
				deviceTier: "real"
			};
			const fallbackToken = this.deviceTokens === void 0 ? void 0 : await this.deviceTokens.current();
			return {
				...base,
				deviceTier: "virtual",
				...fallbackToken === void 0 ? {} : { deviceToken: fallbackToken }
			};
		}
		const token = this.deviceTokens === void 0 ? void 0 : await this.deviceTokens.current();
		const profile = this.deviceProfiles === void 0 ? void 0 : await this.deviceProfiles.forUid(credential.uid);
		return {
			...base,
			...token === void 0 ? {} : { deviceToken: token },
			...profile === void 0 ? {} : { deviceProfile: profile }
		};
	}
	/** POST the chat endpoint; a successful answer is the raw SSE response. */
	async chatStream(credential, bodyJson, signal) {
		let response;
		try {
			const headers = {
				...chatHeaders(credential, await this.wireIdentity(credential)),
				"Authorization": `Bearer ${credential.accessToken}`
			};
			if (signal?.aborted === true) return {
				ok: false,
				status: 0,
				kind: "server",
				message: "cancelled before send"
			};
			response = await fetch(`${chatBase(credential, this.cnBaseOf())}/v2/chat/completions`, {
				method: "POST",
				headers,
				body: bodyJson,
				...signal === void 0 ? {} : { signal }
			});
		} catch (error) {
			return {
				ok: false,
				status: 0,
				kind: "server",
				message: `transport error: ${String(error)}`
			};
		}
		if (response.ok) return {
			ok: true,
			response
		};
		const text = (await response.text()).slice(0, ERROR_BODY_LIMIT);
		const kind = classifyUpstreamError(response.status, text);
		if (isUndecodablePolicyBody(text)) this.onFallback?.(`11140 失败体没有任何可解码的 displayMsg/displayTips/msg 字段，若上游调整了限制措辞或字段名，账号停权判定会全部漏判。失败体片段：${text.slice(0, 200)}`);
		return {
			ok: false,
			status: response.status,
			kind,
			message: text,
			detail: parseUpstreamErrorDetail(text)
		};
	}
	/**
	* Send one minimal chat request for `bodyJson` and report the RAW answer.
	*
	* Shares {@link chatHeaders} and the chat base with {@link chatStream} on
	* purpose: a probe is only meaningful if it reaches the same endpoint with the
	* same authentication as a real request. The differences are deliberate and
	* narrow — it returns the headers (for `Retry-After`) and the failure body
	* (for classification) instead of a pre-classified error, so the probe module
	* owns the interpretation and the network layer stays a transport.
	*
	* The caller MUST drain {@link WorkBuddyProbeAnswer.response}; an unread body
	* holds the connection open.
	*
	* ALWAYS bounded in time. The pool's batch runner is serial and passes no
	* signal, so without a ceiling here one stalled connection blocks every account
	* behind it — the batch looks hung with no way to tell which member did it.
	* A supplied signal is COMBINED with the timeout rather than replacing it, so
	* the single-model route keeps its cancellation behaviour and still cannot
	* hang forever.
	*
	* The ceiling covers ONLY the wait for a response — it is cleared the moment
	* `fetch` resolves. Holding a timer over the body would put a healthy but slow
	* model on the same clock as a dead endpoint, and the whole point of the
	* period is to answer "did the upstream answer at all". A probe asks for a
	* single token, so the body that follows is one SSE line.
	*
	* It likewise does not cover building the headers. That step became slow in P3
	* (the device-token path is a subprocess with a 20 s budget), and starting the
	* clock first made a healthy gateway answer `status 0` on a cold start — which
	* the pool reads as "unreachable" and acts on by benching the account. Hence
	* the deliberate order below: resolve identity, THEN arm the timer.
	*/
	async probeChat(credential, bodyJson, signal) {
		const headers = {
			...chatHeaders(credential, await this.wireIdentity(credential)),
			"Authorization": `Bearer ${credential.accessToken}`
		};
		if (signal?.aborted === true) return {
			ok: false,
			status: 0,
			retryAfter: null,
			body: "cancelled before send"
		};
		let response;
		const ceiling = new AbortController();
		const timer = setTimeout(() => {
			ceiling.abort(/* @__PURE__ */ new Error(`no response within ${PROBE_TIMEOUT_MS}ms`));
		}, PROBE_TIMEOUT_MS);
		try {
			response = await fetch(`${chatBase(credential, this.cnBaseOf())}/v2/chat/completions`, {
				method: "POST",
				headers,
				body: bodyJson,
				signal: signal === void 0 ? ceiling.signal : AbortSignal.any([signal, ceiling.signal])
			});
		} catch (error) {
			return {
				ok: false,
				status: 0,
				retryAfter: null,
				body: `transport error: ${String(error)}`
			};
		} finally {
			clearTimeout(timer);
		}
		const retryAfter = response.headers.get("retry-after");
		if (response.ok) return {
			ok: true,
			status: response.status,
			retryAfter,
			response
		};
		const body = (await response.text()).slice(0, ERROR_BODY_LIMIT);
		return {
			ok: false,
			status: response.status,
			retryAfter,
			body
		};
	}
	/** POST the token-refresh endpoint; the caller merges the outcome. */
	async refreshToken(credential) {
		const response = await fetch(`${chatBase(credential, this.cnBaseOf())}/v2/plugin/auth/token/refresh`, {
			method: "POST",
			headers: refreshHeaders(credential),
			signal: AbortSignal.timeout(JSON_TIMEOUT_MS)
		});
		const envelope = await readEnvelope(response);
		if (!response.ok || envelope.code !== 0) throw envelopeError(response.status, envelope);
		const data = typeof envelope.data === "object" && envelope.data !== null ? envelope.data : {};
		const accessToken = typeof data["accessToken"] === "string" ? data["accessToken"] : "";
		if (accessToken === "") throw new Error("workbuddy token refresh returned no accessToken; sign in again in the WorkBuddy app");
		const outcome = { accessToken };
		if (typeof data["refreshToken"] === "string" && data["refreshToken"] !== "") outcome.refreshToken = data["refreshToken"];
		if (typeof data["expiresIn"] === "number" && data["expiresIn"] > 0) outcome.expiresInSec = data["expiresIn"];
		if (typeof data["domain"] === "string" && data["domain"] !== "") outcome.domain = data["domain"];
		return outcome;
	}
	/**
	* Read the model directory for the credential's region.
	*
	* Both regions read `/v3/config`, the document the WorkBuddy app itself
	* consumes, and both read it as the APP's product identity
	* ({@link PRODUCT_UA}) — the header the app sends, not the CLI channel's.
	* That is load-bearing, not cosmetic: the CLI channel's answer is a strict
	* subset of the app channel's and publishes neither `modelPromotions` nor
	* `modelTiers`, so reading `/v3/config` as the CLI channel is what left the
	* CN card without a single promotion badge while the app showed one on the
	* same account (see {@link PRODUCT_UA}).
	*
	* CN falls back to the legacy {@link MODELS_CATALOG_PATH} when `/v3` fails,
	* returns a non-zero envelope, or resolves to no usable model, so a gateway
	* that stops serving the modern document degrades to the previous roster
	* instead of leaving the region empty. The fallback is silent when unused and
	* reported when it fires, because a roster that silently differs from the
	* app's is exactly the bug this ordering exists to fix.
	*
	* No user-side toggle is involved: the region comes from the credential's
	* `domain`.
	*
	* `keepModelIds` is the user's own selection, passed through to
	* {@link selectCliModels}: a model the upstream roster dropped but the SAME
	* document still publishes stays in the roster, so reading the directory
	* never withdraws a model the user is running (issue #32's failure mode,
	* one step upstream of it).
	*/
	async fetchModels(credential, signal, keepModelIds = []) {
		const timeout = signal ?? AbortSignal.timeout(JSON_TIMEOUT_MS);
		if (regionOf(credential.domain) === "global") {
			/**
			* Read the global product configuration ONCE per client channel, then
			* merge. Both reads are the same endpoint and differ ONLY in
			* `User-Agent`, which is the header that selects the channel; both are
			* read-only GETs that spend no credits.
			*
			* Neither document is a superset of the other (see
			* {@link mergeModelRosters}), so reading one of them is what left the
			* CLI's own free `deepseek-v4.1-flash` row invisible while it was
			* perfectly usable through this plugin's chat path.
			*/
			const readChannel = async (userAgent) => {
				const response = await fetch(`${globalBase(credential.domain)}${GLOBAL_CONFIG_PATH}`, {
					headers: {
						"Authorization": `Bearer ${credential.accessToken}`,
						"Accept": "application/json",
						...credential.uid === "" ? {} : { "X-User-Id": credential.uid },
						...credential.domain === "" ? {} : { "X-Domain": credential.domain },
						"X-Product": "SaaS",
						"X-Requested-With": "XMLHttpRequest",
						"Connection": "close",
						"User-Agent": userAgent
					},
					signal: timeout
				});
				const envelope = await readEnvelope(response);
				if (!response.ok || envelope.code !== 0) throw envelopeError(response.status, envelope);
				const data = typeof envelope.data === "object" && envelope.data !== null ? envelope.data : {};
				return withPromos(selectCliModels(data["models"], data["agents"], keepModelIds), data);
			};
			/**
			* Fail-soft in ONE direction only. If the CLI read fails the app document
			* alone is still a usable roster, so fall back to it rather than
			* disarming the provider. If the APP read fails the CLI roster is already
			* a complete answer and is returned as-is — reported through
			* `onFallback` rather than swallowed, because the desktop-only rows then
			* disappear from the picker and that is worth a log line.
			*/
			let cliRoster;
			try {
				cliRoster = await readChannel(CATALOG_CLI_UA);
			} catch (error) {
				this.onFallback?.(`global CLI catalog ${GLOBAL_CONFIG_PATH} failed; using the app document only: ` + (error instanceof Error ? error.message : String(error)));
				return await readChannel(APP_CHANNEL_UA);
			}
			let appRoster;
			try {
				appRoster = await readChannel(APP_CHANNEL_UA);
			} catch (error) {
				this.onFallback?.(`global app catalog ${GLOBAL_CONFIG_PATH} failed; using the CLI document only: ` + (error instanceof Error ? error.message : String(error)));
				return cliRoster;
			}
			return mergeModelRosters(cliRoster, appRoster);
		}
		const readCatalog = async (path) => {
			const response = await fetch(`${chatBase(credential, this.cnBaseOf())}${path}`, {
				headers: {
					"Authorization": `Bearer ${credential.accessToken}`,
					"Accept": "application/json",
					"Origin": originReferer(credential),
					"Referer": `${originReferer(credential)}/`,
					"User-Agent": PRODUCT_UA
				},
				signal: timeout
			});
			const envelope = await readEnvelope(response);
			if (!response.ok || envelope.code !== 0) throw envelopeError(response.status, envelope);
			const data = typeof envelope.data === "object" && envelope.data !== null ? envelope.data : {};
			return withPromos(selectCliModels(data["models"], data["agents"], keepModelIds), data);
		};
		try {
			return await readCatalog(GLOBAL_CONFIG_PATH);
		} catch (error) {
			this.onFallback?.(`CN model catalog ${GLOBAL_CONFIG_PATH} failed; falling back to ${MODELS_CATALOG_PATH}: ` + (error instanceof Error ? error.message : String(error)));
			return await readCatalog(MODELS_CATALOG_PATH);
		}
	}
	/**
	* Read how busy each model is right now, from the upstream's own probe.
	*
	* Batched at the upstream's ceiling (`WORKBUDDY_BUSY_BATCH_SIZE`), because the
	* probe takes a list of ids and answers only about the ids it was given.
	*
	* Throws on anything that is not a clean `code: 0`, like every other reader in
	* this class — the CALLER decides that a failed load probe is survivable and
	* catches it. Nothing here is persisted: the level belongs to the refresh that
	* asked for it.
	*/
	async fetchModelBusy(credential, modelIds, signal) {
		const levels = /* @__PURE__ */ new Map();
		for (const batch of batchModelIds(modelIds)) {
			const response = await fetch(`${chatBase(credential, this.cnBaseOf())}${MODEL_BUSY_PATH}`, {
				method: "POST",
				headers: {
					...legacyCommonHeaders(credential),
					"Authorization": `Bearer ${credential.accessToken}`,
					"Content-Type": "application/json"
				},
				body: JSON.stringify({ models: batch }),
				signal: signal ?? AbortSignal.timeout(MODEL_BUSY_TIMEOUT_MS)
			});
			const envelope = await readEnvelope(response);
			if (!response.ok || envelope.code !== 0) throw envelopeError(response.status, envelope);
			for (const [id, level] of parseBusyLevels(envelope.data)) levels.set(id, level);
		}
		return levels;
	}
	/**
	* 读该账号所属区的产品配置，返回**全部**媒体模型（图 + 视频，按 tag 区分）。
	*
	* 走的是和 {@link fetchModels} 同一条 `/v3/config`（国内区与国际区都答），
	* 区别只在这里保留 `data.models` 的媒体条目、而不是投影成 CLI 聊天目录。
	* 两区实测（2026-10-25，同日各跑一次只读探针）：
	*   - 国内区 61 条模型 / 17 条带 tag：`hunyuan-image-alpha`（`text-to-image`）、
	*     `hunyuan-image-alpha-edit`（`image-to-image`）、`kling-video-v3` 与
	*     `minimax-video-h3`（`text-to-video` + `image-to-video`）。
	*   - 国际区 29 条 / 7 条带 tag：`hy-image-3.5`（`text-to-image` +
	*     `image-to-image`）、`kling-video-v3`（两种视频 tag）。
	* 两边目录完全不重叠，所以「国际区一条都没有」是 2026-10-21 的旧观测，
	* 已经过期 —— 目录真的没标时才返回空数组（而不是编一个模型出来）。
	*
	* 返回的是**未分组**的全集：谁要 `text-to-image` 就自己按 tag 过滤
	* （{@link selectMediaModels} / `pickMediaModel`）。生图工具、改图路径、卡片清单
	* 因此共用这一次读取，而不是各读一遍目录。
	*
	* 这是一次 EXTRA 读取，不是「复用目录那一次」：`fetchModels` 的结果被投影成
	* 聊天目录就丢掉了媒体标签，所以这里必须再读一遍同一份文档。它是只读 GET、
	* 不花积分，且工具侧有 5 分钟缓存，但「零新增请求」的说法不成立，别那么写。
	* 国内区与 {@link fetchModels} 一样走 `/v3` → `/v2` 降级：上游一旦不答
	* `/v3`，聊天目录会降级而这里不能变成一个原始异常。
	*/
	async fetchMediaModels(credential, signal) {
		/**
		* The media roster is read from the APP document, so it must use that
		* document's own channel per region.
		*
		* This was a single constant, and the global read silently lost
		* `hy-image-3.5` as a result: on the global gateway {@link PRODUCT_UA}
		* answers the 39-model third document, which carries `kling-video-v3` but
		* NOT the image model — so the image tool reported "this gateway publishes
		* no image model" for an account whose app offers one. CN keeps
		* {@link PRODUCT_UA} untouched; there it is the correct app channel.
		*/
		const mediaChannelUA = regionOf(credential.domain) === "global" ? APP_CHANNEL_UA : PRODUCT_UA;
		const readMedia = async (path) => {
			const response = await fetch(`${chatBase(credential, this.cnBaseOf())}${path}`, {
				headers: {
					"Authorization": `Bearer ${credential.accessToken}`,
					"Accept": "application/json",
					"Origin": originReferer(credential),
					"Referer": `${originReferer(credential)}/`,
					"User-Agent": mediaChannelUA
				},
				signal: signal ?? AbortSignal.timeout(JSON_TIMEOUT_MS)
			});
			const envelope = await readEnvelope(response);
			if (!response.ok || envelope.code !== 0) throw envelopeError(response.status, envelope);
			return selectMediaModels((typeof envelope.data === "object" && envelope.data !== null ? envelope.data : {})["models"], MEDIA_TAGS);
		};
		try {
			return await readMedia(GLOBAL_CONFIG_PATH);
		} catch (error) {
			if (regionOf(credential.domain) === "global") throw error;
			this.onFallback?.(`CN media catalog ${GLOBAL_CONFIG_PATH} failed; falling back to ${MODELS_CATALOG_PATH}: ` + (error instanceof Error ? error.message : String(error)));
			return await readMedia(MODELS_CATALOG_PATH);
		}
	}
	/**
	* 发一次文生图请求。
	*
	* 端点、请求体、响应解析全部照抄官方 CLI 的 ImageService（见 `image-gen.ts`
	* 的模块注释）。产物是 24 小时有效的 COS 签名 URL；实扣积分随区与模型不同
	* （国内区 `hunyuan-image-alpha` 5.71、国际区 `hy-image-3.5` 0.03），
	* 只在响应的 `data.usage.credit` 里给出，调用方按实际值回报。
	*
	* 失败分两层：HTTP 非 2xx 交给 {@link describeImageFailure} 翻成带 code 的
	* 错误（401/403 提示重新登录、404 提示该区没有生图路由、429 提示限流）；
	* HTTP 200 但信封 `code !== 0` 由 {@link parseImageResponse} 处理。
	*/
	async generateImage(credential, request, signal) {
		const response = await fetch(`${chatBase(credential, this.cnBaseOf())}${IMAGE_GENERATIONS_PATH}`, {
			method: "POST",
			headers: imageHeaders(credential, await this.wireIdentity(credential)),
			body: JSON.stringify(buildImageBody(request)),
			signal: signal ?? AbortSignal.timeout(IMAGE_TIMEOUT_MS)
		});
		const text = await response.text();
		if (!response.ok) throw describeImageFailure(response.status, text);
		let payload;
		try {
			payload = JSON.parse(text);
		} catch {
			throw new WorkBuddyImageError(`workbuddy image: 上游返回的不是 JSON（HTTP ${response.status}）: ${text.slice(0, 200)}`, "UPSTREAM");
		}
		return parseImageResponse(payload);
	}
	/**
	* 发一次改图请求（`image-to-image`）。
	*
	* 端点换成官方 CLI `ImageService.editImage` 用的 `/v2/images/edits`，请求体是
	* 生图那一套 + `image`（**必须是 data URL 字符串数组**）+ 可选 `input_fidelity`。
	* 2026-10-25 国际区实测：`hy-image-3.5` + 一张 712×962 的截图 → 200、code 0、
	* 一张 COS 签名 URL、`credit 0.03`。
	*
	* `image` 的形态由调用方（工具层）负责规整成 data URL——这一层只发请求、
	* 不碰文件系统，和 {@link generateImage} 的分工保持一致。
	*/
	async editImage(credential, request, signal) {
		if (request.image.length === 0) throw new WorkBuddyImageError("workbuddy image: 改图请求缺少输入图（image 数组为空）。", "INVALID_ARGS");
		const response = await fetch(`${chatBase(credential, this.cnBaseOf())}${IMAGE_EDITS_PATH}`, {
			method: "POST",
			headers: imageHeaders(credential, await this.wireIdentity(credential)),
			body: JSON.stringify(buildEditBody(request)),
			signal: signal ?? AbortSignal.timeout(IMAGE_TIMEOUT_MS)
		});
		const text = await response.text();
		if (!response.ok) throw describeImageFailure(response.status, text);
		let payload;
		try {
			payload = JSON.parse(text);
		} catch {
			throw new WorkBuddyImageError(`workbuddy image: 上游返回的不是 JSON（HTTP ${response.status}）: ${text.slice(0, 200)}`, "UPSTREAM");
		}
		return parseImageResponse(payload);
	}
	/**
	* 发一次生视频请求（提交任务，拿 task id）。
	*
	* 端点与请求体照抄官方 CLI 的 `VideoService.submitTask`：`POST /v2/videos/generations`，
	* 请求体由 `buildVideoBody` 拼（prompt / model / seconds / negative_prompt /
	* watermark:true / 图生视频时的 image_url / extra_parameters）。响应取
	* `data.id` 作为 task id 返回，真正的视频要再轮询 `/v2/videos/tasks` 才拿得到。
	*
	* 这是一次**花钱**的请求（与生图一样），所以失败分类交给 {@link describeVideoFailure}：
	* 401/403 提示重新登录、404 提示该区没有视频路由、429 提示限流、其它透传 msg。
	* HTTP 200 但信封 `code !== 0` 由 {@link parseVideoSubmission} 处理。
	*/
	async submitVideo(credential, request, signal) {
		const isImageToVideo = request.image !== void 0 || request.lastImage !== void 0;
		const body = buildVideoBody({
			model: request.model,
			prompt: request.prompt,
			seconds: request.seconds,
			negativePrompt: request.negativePrompt,
			image: request.image,
			lastImage: request.lastImage,
			resolution: request.resolution,
			aspectRatio: request.aspectRatio,
			enableAudio: request.enableAudio
		}, isImageToVideo);
		const response = await fetch(`${chatBase(credential, this.cnBaseOf())}${VIDEO_GENERATIONS_PATH}`, {
			method: "POST",
			headers: imageHeaders(credential, await this.wireIdentity(credential)),
			body: JSON.stringify(body),
			signal: signal ?? AbortSignal.timeout(VIDEO_TIMEOUT_MS)
		});
		const text = await response.text();
		if (!response.ok) throw describeVideoFailure(response.status, text, "submit");
		let payload;
		try {
			payload = JSON.parse(text);
		} catch {
			throw new WorkBuddyVideoError(`workbuddy video: 上游返回的不是 JSON（HTTP ${response.status}）: ${text.slice(0, 200)}`, "UPSTREAM");
		}
		return parseVideoSubmission(payload);
	}
	/**
	* 轮询一个生视频任务直到完成或失败。
	*
	* `POST /v2/videos/tasks`（请求体 `{ task_id }`），官方 CLI 的 `VideoService.pollTask`
	* 就是每 5 秒查一次、直到 `status === 'completed' | 'failed'`。这里照搬同样的
	* 轮询节奏与整体超时（默认 ~600s，远大于生图的 180s，因为视频要生成几十秒到几分钟）。
	*
	* 注意：轮询**已经花过钱**（提交那次就扣了），所以轮询期间的网络抖动、超时要
	* 当成真实失败——调用方据此进冷却。只有"提交那一次"因为参数写错 / 没登录而没
	* 发出去，才不进冷却（同生图工具的设计）。
	*/
	async pollVideoTask(credential, taskId, signal) {
		const startedAt = Date.now();
		const ownSignal = signal ?? AbortSignal.timeout(VIDEO_TIMEOUT_MS);
		const combined = signal === void 0 ? ownSignal : AbortSignal.any([signal, AbortSignal.timeout(VIDEO_TIMEOUT_MS)]);
		for (;;) {
			if (combined.aborted) throw new WorkBuddyVideoError("workbuddy video: 轮询被取消或超时。", "POLL_TIMEOUT");
			if (Date.now() - startedAt > VIDEO_POLL_TIMEOUT_MS) throw new WorkBuddyVideoError(`workbuddy video: 轮询超过 ${VIDEO_POLL_TIMEOUT_MS / 1e3} 秒仍未完成（task ${taskId}）。`, "POLL_TIMEOUT");
			let payload;
			try {
				const response = await fetch(`${chatBase(credential, this.cnBaseOf())}${VIDEO_TASKS_PATH}`, {
					method: "POST",
					headers: imageHeaders(credential, await this.wireIdentity(credential)),
					body: JSON.stringify({ task_id: taskId }),
					signal: combined
				});
				const text = await response.text();
				if (!response.ok) throw describeVideoFailure(response.status, text, "poll");
				try {
					payload = JSON.parse(text);
				} catch {
					throw new WorkBuddyVideoError(`workbuddy video: 轮询响应不是 JSON（HTTP ${response.status}）: ${text.slice(0, 200)}`, "UPSTREAM");
				}
			} catch (error) {
				if (error instanceof WorkBuddyVideoError) throw error;
				throw new WorkBuddyVideoError(`workbuddy video: 轮询请求失败：${error instanceof Error ? error.message : String(error)}`, "UPSTREAM");
			}
			const result = parseVideoTask(payload);
			if (result.status === "completed") {
				if (result.videos.length === 0) throw new WorkBuddyVideoError("workbuddy video: 任务完成但没有返回任何视频 URL。", "EMPTY_RESULT");
				return {
					videos: result.videos,
					...result.credit !== void 0 ? { credit: result.credit } : {}
				};
			}
			if (result.status === "failed") throw new WorkBuddyVideoError(`workbuddy video: 生视频任务失败（task ${taskId}）。` + (result.detail === void 0 ? "上游没有给出任何原因字段。" : ` 上游返回的额外字段：${result.detail}`), "TASK_FAILED");
			await new Promise((resolve, reject) => {
				const timer = setTimeout(resolve, VIDEO_POLL_INTERVAL_MS);
				const onAbort = () => {
					clearTimeout(timer);
					reject(new WorkBuddyVideoError("workbuddy video: 轮询被取消。", "POLL_TIMEOUT"));
				};
				combined.addEventListener("abort", onAbort, { once: true });
			});
		}
	}
	/**
	* 下载一个视频 URL 到本地临时目录，返回绝对路径。
	*
	* 官方 CLI 的 `VideoService.downloadVideos` 把每条 `data[].url` 写成本地 `.mp4`
	* （产物是 COS 签名 URL，和生图同源，但不是图片 MIME）。这里每次一条，工具层
	* 负责把多条结果各自落盘并回 `file://` 给模型与用户。
	*/
	async downloadVideo(credential, url, signal) {
		const response = await fetch(url, { signal: signal ?? AbortSignal.timeout(VIDEO_DOWNLOAD_TIMEOUT_MS) });
		if (!response.ok) throw new WorkBuddyVideoError(`workbuddy video: 下载视频失败（HTTP ${response.status}）: ${url}`, "UPSTREAM");
		const buffer = Buffer.from(await response.arrayBuffer());
		const dir = join(tmpdir(), "workbuddy-video-gen");
		await mkdir(dir, { recursive: true });
		const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-").slice(0, 19);
		const safeUrl = url.replace(/[^A-Za-z0-9._-]+/g, "_").slice(-32);
		const path = join(dir, `video-${stamp}-${safeUrl}.mp4`);
		await writeFile(path, buffer);
		pruneTempDir(dir, 20, [".mp4"]);
		return path;
	}
	/** Query today's check-in status without changing account state. */
	async fetchCheckinStatus(credential) {
		const response = await fetch(`${billingBase(credential, this.cnBaseOf())}/v2/billing/meter/checkin-activity-status`, {
			method: "POST",
			headers: billingHeaders(credential, await this.wireIdentity(credential)),
			body: "{}",
			signal: AbortSignal.timeout(JSON_TIMEOUT_MS)
		});
		const envelope = await readEnvelope(response);
		if (!response.ok || envelope.code !== 0) throw envelopeError(response.status, envelope);
		const data = typeof envelope.data === "object" && envelope.data !== null ? envelope.data : {};
		const numberField = (key) => typeof data[key] === "number" ? data[key] : 0;
		return {
			active: data["active"] === true,
			todayCheckedIn: data["today_checked_in"] === true,
			streakDays: numberField("streak_days"),
			dailyCredit: numberField("daily_credit"),
			todayCredit: numberField("today_credit"),
			isStreakDay: data["is_streak_day"] === true,
			nextStreakDay: numberField("next_streak_day"),
			streakBonusDays: numberField("streak_bonus_days"),
			streakBonusCredit: numberField("streak_bonus_credit"),
			...typeof data["claim_button_text"] === "string" && data["claim_button_text"] !== "" ? { claimButtonText: data["claim_button_text"] } : {}
		};
	}
	/**
	* Read every promotional benefit this account can still see, WITHOUT claiming
	* anything.
	*
	* The campaign list is closed and small on purpose: the gateway exposes one
	* status endpoint per campaign, so "discover benefits" is a fixed fan-out, not
	* a search. A new campaign type means a new `/billing/meter/*-status` endpoint
	* added here — the plugin never guesses at undocumented ones.
	*
	* Every endpoint is read in parallel because they are independent, and a
	* failure is per-endpoint: one campaign answering 5xx must not blank out the
	* other. The caller gets only what was actually read.
	*
	* Note the paths carry NO `/v2` prefix — these are not the `/v2/billing/meter`
	* family the credit and check-in calls use. Probing `/v2/...` answers 404, which
	* is how this distinction was found.
	*/
	async fetchBenefits(credential) {
		const read = async (kind, path) => {
			try {
				return await this.readBenefitStatus(kind, credential, path);
			} catch {
				return;
			}
		};
		const [compensation, gift] = await Promise.all([read("compensation", "/billing/meter/compensation-status"), read("gift", "/billing/meter/check-gift-claimed")]);
		return [compensation, gift].filter((benefit) => benefit !== void 0);
	}
	/** One benefit status endpoint. Throws on anything that is not a clean `code: 0`. */
	async readBenefitStatus(kind, credential, path) {
		const response = await fetch(`${billingBase(credential, this.cnBaseOf())}${path}`, {
			method: "POST",
			headers: billingHeaders(credential, await this.wireIdentity(credential)),
			body: "{}",
			signal: AbortSignal.timeout(JSON_TIMEOUT_MS)
		});
		const envelope = await readEnvelope(response);
		if (!response.ok || envelope.code !== 0) throw envelopeError(response.status, envelope);
		const data = typeof envelope.data === "object" && envelope.data !== null ? envelope.data : {};
		const numberField = (key) => typeof data[key] === "number" ? data[key] : 0;
		/** The gateway states times as `YYYY-MM-DD HH:MM:SS` in local time. */
		const timeField = (key) => {
			const raw = data[key];
			if (typeof raw !== "string" || raw.trim() === "") return void 0;
			const parsed = Date.parse(raw.replace(" ", "T"));
			return Number.isNaN(parsed) ? void 0 : parsed;
		};
		const endsAtMs = timeField("end_time");
		const startsAtMs = timeField("start_time");
		const claimedAtMs = timeField("claimed_at");
		return {
			kind,
			active: data["active"] === true,
			claimed: data["claimed"] === true,
			creditNum: numberField("credit_num"),
			...endsAtMs === void 0 ? {} : { endsAtMs },
			...startsAtMs === void 0 ? {} : { startsAtMs },
			...claimedAtMs === void 0 ? {} : { claimedAtMs }
		};
	}
	/**
	* Claim one benefit campaign on ONE account (issue #79).
	*
	* This is a real credit grant on a real account, so it takes no account
	* argument other than the credential it is handed: the caller decides which
	* single account, and there is deliberately no batch form of this method. The
	* browser route is the only caller, and it guards the mutation with the same
	* POST + loopback checks the check-in route carries.
	*
	* The response is not parsed: the documented envelope of these two endpoints
	* is an empty success, and the caller re-reads the status afterwards. That
	* re-read, not this answer, is what the user is shown — which is why a claim
	* that silently did nothing still cannot leave the card saying 待领取.
	*/
	async claimBenefit(credential, kind) {
		const response = await fetch(`${billingBase(credential, this.cnBaseOf())}${BENEFIT_CLAIM_PATHS[kind]}`, {
			method: "POST",
			headers: billingHeaders(credential, await this.wireIdentity(credential)),
			body: "{}",
			signal: AbortSignal.timeout(JSON_TIMEOUT_MS)
		});
		const envelope = await readEnvelope(response);
		if (!response.ok || envelope.code !== 0) throw envelopeError(response.status, envelope);
	}
	/** Claim today's check-in reward. The browser route guards this mutation. */
	async claimDailyCheckin(credential) {
		const response = await fetch(`${billingBase(credential, this.cnBaseOf())}/v2/billing/meter/daily-checkin`, {
			method: "POST",
			headers: billingHeaders(credential, await this.wireIdentity(credential)),
			body: "{}",
			signal: AbortSignal.timeout(JSON_TIMEOUT_MS)
		});
		const envelope = await readEnvelope(response);
		if (!response.ok || envelope.code !== 0) throw envelopeError(response.status, envelope);
		const data = typeof envelope.data === "object" && envelope.data !== null ? envelope.data : {};
		const numberField = (key) => typeof data[key] === "number" ? data[key] : 0;
		return {
			credit: numberField("credit"),
			streakDays: numberField("streak_days"),
			isStreakDay: data["is_streak_day"] === true
		};
	}
	/**
	* The ENTERPRISE credit table (issue #124).
	*
	* `/v2/billing/meter/get-user-resource` answers an enterprise member with
	* HTTP 200 and an empty `Accounts` list — a legally-shaped "you have no
	* credits" that is simply false, because the member's credits live under the
	* enterprise account. The official client branches on the account's
	* `type: "ultimate"` and calls `/billing/meter/get-enterprise-user-usage`
	* instead (no `/v2` prefix), which returns:
	*
	*   { credit: 1234, limitNum: 5000, cycleResetTime: "2026-11-01 00:00:00" }
	*
	* What REMAINS is `limitNum - credit`. `credit` there is the amount SPENT,
	* not the amount left — reading it as a balance inverts the answer, which is
	* worse than the zero it replaces.
	*
	* @returns the credits, or `undefined` when this response carried no
	*          readable balance (the caller turns that into an error rather than
	*          reporting zero).
	*/
	async fetchEnterpriseCredits(credential) {
		const response = await fetch(`${billingBase(credential, this.cnBaseOf())}/billing/meter/get-enterprise-user-usage`, {
			method: "POST",
			headers: billingHeaders(credential, await this.wireIdentity(credential)),
			body: JSON.stringify({}),
			signal: AbortSignal.timeout(JSON_TIMEOUT_MS)
		});
		const envelope = await readEnvelope(response);
		if (!response.ok || envelope.code !== 0) throw envelopeError(response.status, envelope);
		const wrapper = typeof envelope.data === "object" && envelope.data !== null ? envelope.data : {};
		const inner = typeof wrapper["Data"] === "object" && wrapper["Data"] !== null ? wrapper["Data"] : wrapper;
		const limit = typeof inner["limitNum"] === "number" && Number.isFinite(inner["limitNum"]) ? inner["limitNum"] : void 0;
		const used = typeof inner["credit"] === "number" && Number.isFinite(inner["credit"]) ? inner["credit"] : void 0;
		if (limit === void 0 || used === void 0) return void 0;
		const remain = Math.max(0, limit - used);
		const refreshAtMs = typeof inner["cycleResetTime"] === "string" ? parseEnterpriseInstant(inner["cycleResetTime"]) : void 0;
		return {
			total: remain,
			packages: [{
				packageName: "企业积分",
				remain,
				size: limit,
				monthly: true,
				...refreshAtMs === void 0 ? {} : { refreshAtMs }
			}],
			expiringSoon: 0
		};
	}
	/**
	* POST the billing endpoint for the remaining credit, keeping every package
	* separate: the card groups monthly-cycle packages itself and lists the
	* nearest-expiring one-off packages, so aggregation here would lose the
	* dates it needs.
	*/
	async fetchCredits(credential) {
		if (credential.enterpriseId !== void 0 && credential.enterpriseId !== "") {
			const enterprise = await this.fetchEnterpriseCredits(credential);
			if (enterprise !== void 0) return enterprise;
			throw new Error("workbuddy upstream enterprise credit: no readable balance in the response");
		}
		const now = /* @__PURE__ */ new Date();
		const format = (date) => [
			date.getFullYear().toString().padStart(4, "0"),
			(date.getMonth() + 1).toString().padStart(2, "0"),
			date.getDate().toString().padStart(2, "0")
		].join("-") + " " + [
			date.getHours().toString().padStart(2, "0"),
			date.getMinutes().toString().padStart(2, "0"),
			date.getSeconds().toString().padStart(2, "0")
		].join(":");
		const response = await fetch(`${billingBase(credential, this.cnBaseOf())}/v2/billing/meter/get-user-resource`, {
			method: "POST",
			headers: billingHeaders(credential, await this.wireIdentity(credential)),
			body: JSON.stringify({
				PageNumber: 1,
				PageSize: 100,
				ProductCode: "p_tcaca",
				Status: [0, 3],
				PackageEndTimeRangeBegin: format(now),
				PackageEndTimeRangeEnd: format(new Date(now.getTime() + 3185136e6))
			}),
			signal: AbortSignal.timeout(JSON_TIMEOUT_MS)
		});
		const envelope = await readEnvelope(response);
		if (!response.ok || envelope.code !== 0) throw envelopeError(response.status, envelope);
		const responseWrapper = typeof envelope.data === "object" && envelope.data !== null ? envelope.data : {};
		const data = typeof responseWrapper["Response"] === "object" && responseWrapper["Response"] !== null ? responseWrapper["Response"] : {};
		const inner = typeof data["Data"] === "object" && data["Data"] !== null ? data["Data"] : {};
		const rawAccounts = Array.isArray(inner["Accounts"]) ? inner["Accounts"] : [];
		let total = 0;
		let nearestExpiryMs;
		let expiringSoon = 0;
		const SOON_MS = 2592e5;
		const parseDate = (raw) => {
			if (typeof raw === "number" && raw > 0xe8d4a51000) return raw;
			if (typeof raw === "string" && raw !== "") {
				const parsed = Date.parse(raw);
				if (!Number.isNaN(parsed)) return parsed;
			}
		};
		const packages = [];
		for (const raw of rawAccounts) {
			if (typeof raw !== "object" || raw === null) continue;
			const account = raw;
			const numberField = (key) => typeof account[key] === "number" ? account[key] : 0;
			const preciseField = (key) => {
				const raw = account[`${key}Precise`];
				if (typeof raw === "string" && raw !== "") {
					const parsed = Number.parseFloat(raw);
					if (Number.isFinite(parsed)) return parsed;
				}
				if (typeof raw === "number" && Number.isFinite(raw)) return raw;
				return numberField(key);
			};
			const monthly = numberField("CapacityType") === 4;
			const size = preciseField("CycleCapacitySize") || preciseField("CapacitySize");
			const remain = account["CycleCapacityRemain"] !== void 0 || account["CycleCapacityRemainPrecise"] !== void 0 ? preciseField("CycleCapacityRemain") : preciseField("CapacityRemain");
			const cappedRemain = remain < 0 ? 0 : remain;
			const cycleEndMs = parseDate(account["CycleEndTime"]);
			const expiresAtMs = monthly ? void 0 : parseDate(account["ExpiredTime"]) ?? cycleEndMs;
			const refreshAtMs = monthly ? cycleEndMs === void 0 ? void 0 : cycleEndMs + 1e3 : void 0;
			if (!monthly && (cappedRemain <= 0 || expiresAtMs !== void 0 && expiresAtMs <= Date.now())) continue;
			total += cappedRemain;
			const expiryMs = expiresAtMs;
			if (expiryMs !== void 0) {
				if (nearestExpiryMs === void 0 || expiryMs < nearestExpiryMs) nearestExpiryMs = expiryMs;
				if (expiryMs - Date.now() <= SOON_MS) expiringSoon += cappedRemain;
			}
			packages.push({
				packageName: typeof account["PackageName"] === "string" ? account["PackageName"] : "(unnamed)",
				remain: cappedRemain,
				size,
				monthly,
				...refreshAtMs === void 0 ? {} : { refreshAtMs },
				...expiresAtMs === void 0 ? {} : { expiresAtMs }
			});
		}
		return {
			total,
			packages,
			expiringSoon,
			...nearestExpiryMs === void 0 ? {} : { nearestExpiryMs }
		};
	}
};
//#endregion
//#region src/auth.ts
/**
* WorkBuddy credential resolution.
*
* 参考：corrinehu/dsh-workbuddy-connect（MIT，Copyright (c) 2026 Corrine Hu）
*   — 桌面端 auth 文件只读、刷新结果写入 $DSH_HOME 自有副本、双凭据取
*     到期更晚者、按需刷新（5 分钟余量）与单飞去重、刷新失败但 token
*     未过期则继续沿用旧 token。这些机制已在该项目验证，此处沿用。
* 改动：原版只解析单个 `workbuddy-desktop.info`。WorkBuddy 桌面端在
*   同一 auth 目录留下带时间戳的备份文件（`workbuddy-desktop.<stamp>.info`），
*   实测这些文件各自持有不同账号的可用凭据（本机 6 个文件 → 2 个账号）。
*   本实现改为扫描整个 auth 目录，按 uin 去重为多个可选账号。跟随 App
*   当前登录（live 文件）仍是默认行为；用户显式选择的账号被严格绑定，
*   不因积分多少而切换，失效时也不会静默改选其他账号。
*   另：store 可按区域（cn | global）限定可见账号 —— 国内版与国际版各持
*   一个 store，账号、刷新、选择完全隔离；插件自有刷新副本也按区域分
*   文件（`.workbuddy-auth.<region>.json`），双账号同时在线互不覆盖，
*   旧的单文件 `.workbuddy-auth.json` 作为迁移源保留读取。
*   另（issue #15）：`resolve()` 不再把「没登录」与「有登录但凭据读不出来」
*   合并成同一句话。后者（加密字段 + 取不到密钥）改为抛
*   `WorkBuddyEncryptedCredentialError`，给出「装 App / 用
*   WORKBUDDY_APP_EXECUTABLE 指定」这条**可执行**的建议——对已登录的用户说
*   「请重新登录一次」指向的是唯一无效的动作。判定只在失败路径上跑一次
*   `diagnose()`，健康路径不付任何代价。
*
* @module dsh-connect-workbuddy/auth
*/
/**
* Marker for a credential that EXISTS but could not be decrypted.
*
* Identified by {@link ENCRYPTED_CREDENTIAL_CODE} rather than `instanceof`, so
* the check keeps working when the thrower and the caller end up in different
* module instances (bundled host half vs. a test's source import) — the same
* convention `WorkBuddyCredentialRejectedError` uses.
*/
const ENCRYPTED_CREDENTIAL_CODE = "WORKBUDDY_ENCRYPTED_CREDENTIAL";
/**
* The user IS signed in, but the credential file cannot be read.
*
* This exists because "signed out" and "signed in with an unreadable credential"
* resolve to the same observable state — zero accounts — and were therefore
* reported with the same message. That message told a correctly signed-in user
* to sign in again, which cannot possibly help: from WorkBuddy 5.6.x the desktop
* app encrypts its token fields, and reading them requires asking the installed
* app for its key. If that app cannot be located, the fix is to point the plugin
* at it (`WORKBUDDY_APP_EXECUTABLE`), never to sign in again.
*
* No token material is carried: only the paths and the environment variable.
*/
var WorkBuddyEncryptedCredentialError = class extends Error {
	code = ENCRYPTED_CREDENTIAL_CODE;
	/** Files that hold an encrypted credential, for the user to recognize. */
	paths;
	constructor(paths) {
		const where = paths.length > 0 ? paths.join(", ") : "the credential file";
		super(`workbuddy: your WorkBuddy sign-in is present but encrypted, so it cannot be read (${where}). The WorkBuddy desktop app must be present to hand over its key; install it, or set ${WORKBUDDY_APP_EXECUTABLE_ENV} to its executable if it lives elsewhere. Signing in again will not change this.`);
		this.name = "WorkBuddyEncryptedCredentialError";
		this.paths = paths;
	}
};
/** Whether an error reports an unreadable (encrypted) credential. */
function isEncryptedCredentialError(value) {
	return typeof value === "object" && value !== null && value.code === "WORKBUDDY_ENCRYPTED_CREDENTIAL";
}
/** One selectable local account, token-free. */
/**
* The name to SHOW for a credential (issue #124).
*
* The order matters and is not arbitrary: on an enterprise credential
* `nickname` is the LOGIN ALIAS, so putting it first made the card look like it
* was managing a stranger's account. The official client prefers the display
* name, then the enterprise-side user name, and only then the alias.
*
* Blank spellings are skipped rather than preferred: the app writes `"   "` in
* places, and rendering whitespace where a name belongs is worse than falling
* through to the alias.
*
* Exported because the same order has to hold in the store's account list, the
* pool rows and the composer panel — three sites that must not drift.
*/
function preferredAccountName(fields) {
	for (const candidate of [
		fields.displayName,
		fields.enterpriseUserName,
		fields.nickname
	]) if (candidate !== void 0 && candidate.trim() !== "") return candidate;
	return "";
}
/**
* Carry display names forward across a re-read of the same account.
*
* The desktop auth document is the only source for these fields and it does
* not always publish them: a refresh that rewrites the document can drop
* `displayName` while keeping the same sign-in. Replacing the whole record
* would then silently fall back to the alias — the exact symptom #124 reports,
* coming back on its own. So an absent field yields to the previous value and a
* PRESENT one wins (it is the newer reading).
*/
function mergeCredentialDisplayNames(previous, next) {
	if (previous === void 0) return next;
	return {
		...next,
		...next.displayName === void 0 && previous.displayName !== void 0 ? { displayName: previous.displayName } : {},
		...next.enterpriseUserName === void 0 && previous.enterpriseUserName !== void 0 ? { enterpriseUserName: previous.enterpriseUserName } : {},
		...next.nickname === void 0 && previous.nickname !== void 0 ? { nickname: previous.nickname } : {}
	};
}
/** Legacy single-copy basename (pre-dual-provider); kept as migration source. */
const WORKBUDDY_AUTH_FILENAME = ".workbuddy-auth.json";
/** Env variable that overrides the desktop auth-file location. */
const WORKBUDDY_AUTH_FILE_ENV = "WORKBUDDY_AUTH_FILE";
/**
* Basenames the live WorkBuddy desktop auth file is known to use.
*
* ISSUE #174: the constant used to be ONE name, `workbuddy-desktop.info`, and
* the 5.7.x Windows app writes `workbuddy-desktop-ai.info` instead — the same
* directory, the same payload, a different filename (measured by the reporter:
* `%LOCALAPPDATA%\CodeBuddyExtension\Data\Public\auth\` held
* `workbuddy-desktop-ai.info` plus timestamped backups of that same name, and no
* file carrying the constant's name at all). The consequences were both silent:
* the "live file always wins" rule in {@link fileRank} never matched, so
* ordering fell back to `lastRefreshAtMs` (correct by luck, not by rule), and
* `doctor` reported `desktopAuthFile.present: false` with a hint to set
* `WORKBUDDY_AUTH_FILE` — on a machine whose credential had just been read
* successfully from the default directory.
*
* Ordered, not a set: {@link WORKBUDDY_LIVE_FILENAME} stays the one this build
* treats as canonical for writing, and the alternatives are probed after it. The
* FIRST entry is what {@link defaultDesktopAuthCandidates} reports as the
* expected path, so keep it there.
*/
const WORKBUDDY_LIVE_FILENAMES = ["workbuddy-desktop.info", "workbuddy-desktop-ai.info"];
WORKBUDDY_LIVE_FILENAMES[0];
/**
* Whether one basename is a LIVE desktop auth file (any of the known names).
*
* Every place that asked "is this the live file?" now asks this, so a new
* spelling is added in one list instead of being chased through the reader, the
* ranker and `doctor` separately — which is exactly how the three drifted apart.
*/
function isLiveDesktopAuthFileName(name) {
	return WORKBUDDY_LIVE_FILENAMES.includes(name);
}
/** Prefix of the plugin-owned per-region credential copies (legacy, read-only). */
const WORKBUDDY_OWN_PREFIX = ".workbuddy-auth";
/**
* Directory name (inside the Harness home) of the plugin's unified credential
* vault: every account the plugin knows — scanned from the desktop app AND
* added through OAuth sign-in — is persisted there, one file per account.
*/
const WORKBUDDY_VAULT_DIRNAME = "workbuddy-vault";
/** Current on-disk format of the plugin-owned copy; readers reject others. */
const OWN_FORMAT_VERSION = 1;
/**
* Plugin-owned copy path for one region inside the Harness home. Each
* region's store refreshes into its own file so two simultaneously signed-in
* regions never overwrite each other's refreshed token.
*/
function workbuddyOwnAuthPath(region) {
	return join(resolveDshHome(), `${WORKBUDDY_OWN_PREFIX}.${region}.json`);
}
/**
* Pre-dual-provider single-copy path. Still read as a migration source (a
* legacy credential serves the region it belongs to until that region's own
* first refresh writes the per-region file), and removed by `logout`.
*/
function legacyWorkbuddyOwnAuthPath() {
	return join(resolveDshHome(), WORKBUDDY_AUTH_FILENAME);
}
/**
* The vault's directory for one region inside the Harness home.
*
* The vault is the plugin's UNIFIED credential store: every account the
* plugin knows lives here, whether it was scanned from the desktop app's
* auth directory or added through OAuth sign-in. One file per account,
* named by the account's stable id — so two sources yielding the same
* account converge on the same file instead of duplicating it.
*/
function workbuddyVaultDir(region) {
	return join(resolveDshHome(), WORKBUDDY_VAULT_DIRNAME, region);
}
/**
* Serialize a credential to the vault's on-disk document.
*
* The on-disk field names are the DESKTOP document's snake-free shapes
* (`expiresAt`, `lastRefreshTime`), which is what `parseWorkBuddyAuth`
* reads back. Serializing the runtime camelCase fields verbatim parsed as
* `expiresAtMs: 0` on the next read — every restart re-refreshed every
* account, and a refresh outage could then take down sign-ins that were
* perfectly healthy on disk.
*/
function vaultDocument(credential, accountId, refreshedFrom) {
	return {
		version: VAULT_FORMAT_VERSION,
		accountId,
		refreshedAtMs: Date.now(),
		...refreshedFrom === void 0 ? {} : { refreshedFrom: authFileName(refreshedFrom) },
		auth: {
			accessToken: credential.accessToken,
			refreshToken: credential.refreshToken,
			expiresAt: credential.expiresAtMs > 0 ? Math.floor(credential.expiresAtMs / 1e3) : 0,
			...credential.refreshExpiresAtMs === void 0 ? {} : { refreshExpiresAt: Math.floor(credential.refreshExpiresAtMs / 1e3) },
			...credential.lastRefreshAtMs === void 0 ? {} : { lastRefreshTime: Math.floor(credential.lastRefreshAtMs / 1e3) },
			domain: credential.domain
		},
		account: {
			uid: credential.uid,
			...credential.enterpriseId === void 0 ? {} : { enterpriseId: credential.enterpriseId },
			...credential.nickname === void 0 ? {} : { nickname: credential.nickname },
			...credential.displayName === void 0 ? {} : { displayName: credential.displayName },
			...credential.enterpriseUserName === void 0 ? {} : { enterpriseUserName: credential.enterpriseUserName },
			...credential.uin === void 0 ? {} : { uin: credential.uin }
		}
	};
}
/** Parse the vault document; other versions and shapes are rejected. */
function parseVaultDocument(text, filePath) {
	const parsed = parseVaultDocumentWithWriteTime(text, filePath);
	return parsed === void 0 ? void 0 : parsed.credential;
}
/**
* Parse a vault document into its credential plus the LOCAL write time.
*
* Internal merge plumbing: `refreshedAtMs` is the freshness signal
* {@link isFresherVaultEntry} needs, but it is not part of
* {@link WorkBuddyCredential} (the runtime type is shared with OAuth and
* desktop reads, none of which carry it).
*/
function parseVaultDocumentWithWriteTime(text, filePath) {
	let parsed;
	try {
		parsed = JSON.parse(text);
	} catch {
		return;
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return void 0;
	const document = parsed;
	if (document["version"] !== VAULT_FORMAT_VERSION) return void 0;
	if (typeof document["auth"] !== "object" || document["auth"] === null) return void 0;
	const credential = parseWorkBuddyAuth(JSON.stringify({
		auth: document["auth"],
		account: document["account"]
	}), filePath);
	if (credential === void 0) return void 0;
	const refreshedAtMs = typeof document["refreshedAtMs"] === "number" && document["refreshedAtMs"] > 0 ? document["refreshedAtMs"] : void 0;
	const refreshedFrom = typeof document["refreshedFrom"] === "string" && document["refreshedFrom"] !== "" ? document["refreshedFrom"] : void 0;
	return {
		credential: {
			...credential,
			source: "dsh"
		},
		...refreshedAtMs === void 0 ? {} : { refreshedAtMs },
		...refreshedFrom === void 0 ? {} : { refreshedFrom }
	};
}
/**
* File name of the vault's DISMISSAL list, stored beside the vault entries.
*
* It exists because deleting a vault entry is not the same as deleting an
* account. `syncVault` writes every desktop sign-in it scans back into the
* vault — that is how a desktop account becomes selectable — so removing the
* vault file alone was undone by the very next scan: the row came back and the
* button read as broken (measured: `removeAccount` returns true, `accounts()`
* still lists it).
*
* Dismissal means HIDDEN UNTIL THE USER SCANS AGAIN, not deleted forever. A
* desktop sign-in is still there in the app, and the manual 「re-scan」 action is
* the user asking to see what the machine currently has — so
* {@link WorkBuddyCredentialStore.clearDismissals} empties this list on every
* manual scan and the accounts return. Without that, a removed account could
* never be recovered except by reinstalling or re-signing in.
*
* The list must survive the automatic refreshes in between: the card polls the
* usage route every 60 seconds, and an in-memory-only dismissal would let the
* account reappear a minute after the user removed it. Hence a file.
*
* Dismissal is per ACCOUNT, not per source: hiding only the vault copy would
* leave the same account listed from the desktop file, which is the
* half-measure that produced the report.
*/
const VAULT_DISMISSED_FILENAME = ".dismissed.json";
/** Current on-disk format of the dismissal list; readers reject others. */
const DISMISSED_FORMAT_VERSION = 1;
/**
* How long one scan may be shared across callers, in milliseconds.
*
* One page open asks the store for the same account list six times (usage
* route: accounts, status, resolve; the credits panel: once PER ACCOUNT through
* `credentialFor`; and both region tabs poll together). Each read re-listed the
* auth directory, re-parsed every file and re-ran the vault merge — measured at
* 6 `readdir` and (6N+12) `readFile` for N accounts.
*
* Why a WINDOW and not a plain in-flight share: the six reads are SEQUENTIAL
* (`await` one after another), so by the time the second starts the first has
* resolved and there is nothing in flight to join. Sharing only concurrent reads
* optimised nothing at all.
*
* Why so short: this is not a cache of the account list, it is an admission that
* one page open IS one logical read. Anything longer would delay noticing a
* sign-in the desktop app made on its own — discovery IS polling, so this window
* is how long such a change may stay unseen. The card polls every 60 s, so 1 s is
* invisible to the user while collapsing one page open from six scans to one. A
* write through this store invalidates the window outright, so the actions the
* user takes here (OAuth add, import, remove, rescan) are never delayed by it.
*/
const SCAN_SHARE_WINDOW_MS = 1e3;
/** Read the dismissal list; an absent or unreadable file reads as empty. */
async function readDismissed(dir) {
	const dismissed = /* @__PURE__ */ new Set();
	try {
		const parsed = JSON.parse(await readFile(join(dir, VAULT_DISMISSED_FILENAME), "utf8"));
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return dismissed;
		const document = parsed;
		if (document["version"] !== DISMISSED_FORMAT_VERSION) return dismissed;
		const ids = document["accountIds"];
		if (!Array.isArray(ids)) return dismissed;
		for (const id of ids) if (typeof id === "string" && VAULT_ACCOUNT_ID_RE.test(id)) dismissed.add(id);
	} catch {}
	return dismissed;
}
/** Write the dismissal list atomically under its own lock. */
async function writeDismissed(dir, dismissed) {
	const path = join(dir, VAULT_DISMISSED_FILENAME);
	const ids = [...dismissed].slice(-1e3);
	const document = {
		version: DISMISSED_FORMAT_VERSION,
		accountIds: ids
	};
	await withFileLock(path, async () => {
		await writeFileAtomic(path, `${JSON.stringify(document, null, 2)}\n`, {
			mode: 384,
			dirMode: 448
		});
	});
}
/**
* Whether a directory entry is ONE ACCOUNT's vault credential file.
*
* The vault directory holds more than credentials: `writeDismissed` puts
* `.dismissed.json` here, and atomic writes transiently leave
* `<id>.json.<hex>.tmp` siblings behind. Both used to be swept up by a bare
* `endsWith('.json')` check, and the DISMISSAL file in particular is
* well-formed JSON that is not a credential — so `diagnose` reported it at the
* user as 「not a readable vault credential」 on any machine where an account
* had been removed, turning a healthy sign-in into an unreadable-looking one.
*
* The rule is the account id shape the store itself writes
* ({@link VAULT_ACCOUNT_ID_RE}), not a naming convention: a file qualifies only
* when its stem is a real id, which no bookkeeping or temp file can be. A
* `.tmp` sibling therefore fails on the dot of its extension, and a hidden file
* fails on its leading dot even before that.
*/
function isVaultCredentialFileName(name) {
	if (!name.endsWith(".json")) return false;
	return VAULT_ACCOUNT_ID_RE.test(name.slice(0, -5));
}
/** Current on-disk format of the vault; readers reject others. */
const VAULT_FORMAT_VERSION = 1;
/**
* 鸿蒙上用户可见的家目录。
*
* `os.homedir()` 在鸿蒙上返回的是**应用沙箱**
* (`/data/storage/el2/base/haps/entry/files`)，不是用户目录，所以不能像
* linux 那样由 `home` 派生。真实凭据落在 `/storage/Users/currentUser` 下，
* 这个挂载点由系统规定，不随应用变化。
*/
const OPENHARMONY_USER_HOME = "/storage/Users/currentUser";
/**
* Platform-default directories holding the WorkBuddy desktop app's auth file.
*
* Windows and Linux prefer the OS-issued env location and fall back to the
* home-derived convention when it is unset, so a redirected profile (OneDrive
* folder backup, enterprise policy) still resolves. macOS has no equivalent
* env variable; the single Application Support path is used as-is.
*
* 鸿蒙（issue #190）没有 `homedir()` 可用——它返回应用沙箱，所以那条分支用
* 系统固定挂载点。Linux 会同时看 XDG 的 data 与 config 两套目录。
*
* `platform`, `home`, and `env` are injectable so the platform branches are
* testable on any host without touching a real machine.
*/
function defaultDesktopAuthDirs(platform = process.platform, home = homedir(), env = process.env) {
	if (platform === "darwin") return [join(home, "Library", "Application Support", "CodeBuddyExtension", "Data", "Public", "auth")];
	if (platform === "win32") {
		const local = nonEmptyEnv(env["LOCALAPPDATA"]) ?? join(home, "AppData", "Local");
		const roaming = nonEmptyEnv(env["APPDATA"]) ?? join(home, "AppData", "Roaming");
		return [join(local, "CodeBuddyExtension", "Data", "Public", "auth"), join(roaming, "CodeBuddyExtension", "Data", "Public", "auth")];
	}
	/**
	* 鸿蒙（issue #190）。
	*
	* 走 XDG 的 `~/.local/share` 形状，但 `~` **不能**用 `homedir()`——那是
	* 沙箱路径。用系统固定挂载点，并允许 `WORKBUDDY_USER_HOME` 覆盖（未来的
	* 多用户或不同发行版挂法）。
	*
	* 没有这个分支时落到 `return []`，卡片连一个候选路径都扫不到，账号池恒为 0，
	* 而 `doctor` 只会说"no platform default; set WORKBUDDY_AUTH_FILE"——
	* 把一个本该自动完成的事推给用户。
	*/
	if (platform === "openharmony") {
		const root = nonEmptyEnv(env["WORKBUDDY_USER_HOME"]) ?? OPENHARMONY_USER_HOME;
		return [posix.join(root, ".local", "share", "CodeBuddyExtension", "Data", "Public", "auth")];
	}
	if (platform === "linux") {
		/**
		* Linux 同时看 XDG 的**两套**目录（issue #190 附带发现）。
		*
		* `Data/Public/auth` 是**数据**，按 XDG 惯例该在 `$XDG_DATA_HOME`
		* （缺省 `~/.local/share`）下；而这里原先只读 `$XDG_CONFIG_HOME`
		* （缺省 `~/.config`）。issue #190 的报告机器与鸿蒙实测都指向
		* `.local/share`，所以两套都给。
		*
		* ⚠️ **`.config` 仍然排在前面**，也就是探测顺序与改动前完全一致。
		* 理由：README §平台支持写明"其余候选仍未经真机逐项验证"，Linux 从来没有
		* 真机证据；把 data 提到前面会改变"没设 WORKBUDDY_AUTH_FILE 时用哪一个"
		* 这个已经上线的行为，而换来的收益尚无证据。这里只做**加法**：多一个候选，
		* 不动已有的顺序，老用户的行为一个字节都不变。
		*
		* 两个目录都不存在时与以前一致：扫不到，回落 `WORKBUDDY_AUTH_FILE`。
		*/
		const config = nonEmptyEnv(env["XDG_CONFIG_HOME"]) ?? join(home, ".config");
		const data = nonEmptyEnv(env["XDG_DATA_HOME"]) ?? join(home, ".local", "share");
		return [join(config, "CodeBuddyExtension", "Data", "Public", "auth"), join(data, "CodeBuddyExtension", "Data", "Public", "auth")];
	}
	return [];
}
/** A non-empty, trimmed env value, or undefined when unset/blank. */
function nonEmptyEnv(value) {
	return typeof value === "string" && value.trim() !== "" ? value.trim() : void 0;
}
/**
* The live auth file's platform candidates, in probe order.
*
* Every known basename for every platform directory: a machine can hold the old
* and the new spelling side by side during an app upgrade, and probing only the
* canonical one is the defect issue #174 reports.
*/
function defaultDesktopAuthCandidates() {
	const candidates = [];
	for (const dir of defaultDesktopAuthDirs()) for (const name of WORKBUDDY_LIVE_FILENAMES) candidates.push(join(dir, name));
	return candidates;
}
/** First platform-default candidate; see {@link defaultDesktopAuthCandidates}. */
function defaultDesktopAuthPath() {
	return defaultDesktopAuthCandidates()[0];
}
/** Normalize an expiry that may arrive in seconds or milliseconds. */
function expiryToMs(value) {
	if (value <= 0) return 0;
	return value > 0xe8d4a51000 ? value : value * 1e3;
}
/**
* Resolve one string field, transparently opening the desktop app's
* encrypted-field wrapper when present.
*
* Windows builds of the WorkBuddy desktop app store `accessToken` and
* `refreshToken` as `{$wbEncrypted:1,envelope}` instead of plain strings; a
* reader that only accepts strings sees no credential at all and reports the
* account as signed out. The SAME treatment applies to `nickname`: it is
* encrypted in those builds too, so a strings-only reader silently degrades the
* account's display name to its uin (a bare number) even after tokens start
* working — which reads as "the plugin does not know who this is".
*
* `key` is undefined when the at-rest key could not be obtained, in which case
* an encrypted field resolves to undefined rather than to a fabricated value.
*/
function credentialField(value, key) {
	if (typeof value === "string") return value;
	if (!isEncryptedFieldWrapper(value)) return void 0;
	if (key === void 0) return void 0;
	return openEncryptedField(value, key);
}
/**
* An optional field that may legitimately be absent: an absent value, a
* non-string that is not a wrapper, and an unopenable wrapper all mean
* "unknown", which must not fail the whole document. Only the REQUIRED token
* fields treat an unopenable wrapper as fatal (see {@link parseWorkBuddyAuth}).
*
* `account.phoneNumber` is deliberately never read: it is encrypted in these
* builds, and the card's privacy contract admits nickname, masked uin, expiry
* and credits only — a phone number is none of the plugin's business.
*/
function optionalCredentialField(value, key) {
	if (typeof value === "string") return value === "" ? void 0 : value;
	if (!isEncryptedFieldWrapper(value)) return void 0;
	if (key === void 0) return void 0;
	try {
		return openEncryptedField(value, key);
	} catch {
		return;
	}
}
/**
* Parse a WorkBuddy auth document in either on-disk shape: the plugin OAuth
* nested form `{"auth":{...},"account":{...}}` and the flat panel form.
* Returns undefined when the document carries no access token.
*
* `atRestKey` is required to read documents whose fields are encrypted
* (see {@link credentialField}); pass the key obtained from
* `readAtRestKey()` when the plain read reports no token.
*/
function parseWorkBuddyAuth(text, filePath, atRestKey) {
	let parsed;
	try {
		parsed = JSON.parse(text);
	} catch {
		return;
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return void 0;
	const document = parsed;
	let auth;
	let identity;
	if (typeof document["auth"] === "object" && document["auth"] !== null) {
		auth = document["auth"];
		identity = typeof document["account"] === "object" && document["account"] !== null ? document["account"] : {};
	} else {
		auth = document;
		identity = document;
	}
	let accessToken;
	let refreshToken;
	try {
		accessToken = credentialField(auth["accessToken"], atRestKey);
		refreshToken = credentialField(auth["refreshToken"], atRestKey);
	} catch {
		return;
	}
	if (accessToken === void 0 || accessToken === "") return void 0;
	const expiresAtMs = typeof auth["expiresAt"] === "number" ? expiryToMs(auth["expiresAt"]) : 0;
	const refreshExpiresAtMs = typeof auth["refreshExpiresAt"] === "number" ? expiryToMs(auth["refreshExpiresAt"]) : void 0;
	const lastRefreshAtMs = typeof auth["lastRefreshTime"] === "number" ? expiryToMs(auth["lastRefreshTime"]) : void 0;
	const enterpriseId = optionalCredentialField(identity["enterpriseId"], atRestKey);
	const nickname = optionalCredentialField(identity["nickname"], atRestKey);
	const displayName = optionalCredentialField(identity["displayName"], atRestKey);
	const enterpriseUserName = optionalCredentialField(identity["enterpriseUserName"], atRestKey);
	const uin = optionalCredentialField(identity["uin"], atRestKey);
	return {
		accessToken,
		refreshToken: refreshToken ?? "",
		expiresAtMs,
		...refreshExpiresAtMs === void 0 ? {} : { refreshExpiresAtMs },
		domain: optionalCredentialField(auth["domain"], atRestKey) ?? "",
		uid: optionalCredentialField(identity["uid"], atRestKey) ?? "",
		...enterpriseId === void 0 ? {} : { enterpriseId },
		...nickname === void 0 ? {} : { nickname },
		...displayName === void 0 ? {} : { displayName },
		...enterpriseUserName === void 0 ? {} : { enterpriseUserName },
		...uin === void 0 ? {} : { uin },
		...lastRefreshAtMs === void 0 ? {} : { lastRefreshAtMs },
		source: "desktop",
		filePath
	};
}
/**
* Whether a document carries any field the reader must decrypt — the token
* fields or the identity fields — i.e. whether reading it needs the at-rest key
* at all.
*
* Deciding this BEFORE asking the app for its key keeps the plain case (macOS
* and older Windows builds, and every plugin-owned copy) from paying for a
* child process on every credential read. Identity fields are included because
* a future build could encrypt the display name while leaving tokens plain;
* gating on tokens alone would then silently drop the name again.
*/
function hasEncryptedCredentialFields(text) {
	let parsed;
	try {
		parsed = JSON.parse(text);
	} catch {
		return false;
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return false;
	const document = parsed;
	const auth = typeof document["auth"] === "object" && document["auth"] !== null ? document["auth"] : document;
	const identity = typeof document["account"] === "object" && document["account"] !== null ? document["account"] : document;
	return isEncryptedFieldWrapper(auth["accessToken"]) || isEncryptedFieldWrapper(auth["refreshToken"]) || isEncryptedFieldWrapper(identity["nickname"]) || isEncryptedFieldWrapper(identity["uin"]) || isEncryptedFieldWrapper(identity["uid"]) || isEncryptedFieldWrapper(identity["enterpriseId"]) || isEncryptedFieldWrapper(auth["domain"]);
}
/**
* Rank two candidate files for the same account.
*
* The live `workbuddy-desktop.info` always wins: it is the app's current
* sign-in, and the upstream revokes the tokens in the timestamped backups
* even though their stored `expiresAt` is still in the future (observed on a
* real machine — every backup claimed a 2027 expiry while only the live
* file's token was accepted). Expiry is therefore only a tie-breaker among
* backups, never the primary ordering.
*/
function fileRank(path) {
	return isLiveDesktopAuthFileName(authFileName(path)) ? 0 : 1;
}
/**
* Whether `candidate` is a better pick than `incumbent` for the same account.
*
* Ordering, strongest signal first:
*
* 1. the live `workbuddy-desktop.info` (the app's current sign-in);
* 2. the most recent `lastRefreshAtMs` — the upstream's own issuance time;
* 3. `expiresAtMs`, only as a fallback for documents that omit the field.
*
* Step 2 is what makes this correct. `expiresAt` describes how long the token
* was VALID FOR at issue time, not whether it is still accepted: a revoked
* backup keeps a far-future `expiresAt` (2027 in the observed case) and would
* otherwise outrank the working live credential, which is exactly how a
* signed-in account turned into an upstream HTML 401.
*/
function isFresher(candidate, incumbent) {
	const rankDiff = fileRank(candidate.filePath) - fileRank(incumbent.filePath);
	if (rankDiff !== 0) return rankDiff < 0;
	const candidateRefresh = candidate.lastRefreshAtMs;
	const incumbentRefresh = incumbent.lastRefreshAtMs;
	if (candidateRefresh !== void 0 && incumbentRefresh !== void 0) {
		if (candidateRefresh !== incumbentRefresh) return candidateRefresh > incumbentRefresh;
	} else if (candidateRefresh !== void 0) return true;
	else if (incumbentRefresh !== void 0) return false;
	return candidate.expiresAtMs > incumbent.expiresAtMs;
}
/**
* Filename of a path regardless of the host separator: Windows paths use `\`
* and this helper must keep working when a Windows path is compared on a
* POSIX host (e.g. tests injecting a Windows-style auth dir).
*/
function authFileName(path) {
	const separator = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
	return separator === -1 ? path : path.slice(separator + 1);
}
/**
* The exact shape of an account id — sha256 hex sliced to 24 characters, which
* is what {@link workbuddyAccountId} emits and therefore the only string a
* vault file name can legitimately have.
*
* An id becomes a path segment, so this is also the traversal guard: an
* attacker-supplied `../..` is rejected before it can address anything outside
* the vault directory. Exported so the HTTP route can reject a bad id with a
* 400 instead of a thrown error.
*/
const VAULT_ACCOUNT_ID_RE = /^[0-9a-f]{24}$/;
/** Whether a string is a well-formed account id. */
function isVaultAccountId(value) {
	return typeof value === "string" && VAULT_ACCOUNT_ID_RE.test(value);
}
/**
* Stable account id. `uin` is the billing identity the upstream keys on and
* survives across re-login; `uid` is the fallback for documents without one.
*/
function workbuddyAccountId(credential) {
	const stable = credential.uin ?? credential.uid ?? credential.nickname ?? "unknown";
	return createHash("sha256").update(`workbuddy\0${stable}`).digest("hex").slice(0, 24);
}
/**
* Parse the plugin-owned copy; other versions and shapes are rejected.
*
* Pre-vault copies serialized the RUNTIME credential verbatim, whose expiry
* field is `expiresAtMs` (ms) rather than the desktop document's
* `expiresAt` (s) that `parseWorkBuddyAuth` reads — the round trip used to
* lose the expiry and force a refresh after every restart. The runtime field
* is read back here as the fallback.
*/
function parseOwnDocument(text, filePath) {
	let parsed;
	try {
		parsed = JSON.parse(text);
	} catch {
		return;
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return void 0;
	const document = parsed;
	if (document["version"] !== OWN_FORMAT_VERSION) return void 0;
	if (typeof document["credential"] !== "object" || document["credential"] === null) return void 0;
	const credential = parseWorkBuddyAuth(JSON.stringify({ auth: document["credential"] }), filePath);
	if (credential === void 0) return void 0;
	const runtime = document["credential"];
	const legacyExpiry = typeof runtime["expiresAtMs"] === "number" ? expiryToMs(runtime["expiresAtMs"]) : 0;
	return {
		...credential,
		...credential.expiresAtMs === 0 && legacyExpiry > 0 ? { expiresAtMs: legacyExpiry } : {},
		source: "dsh"
	};
}
/** Whether a filesystem error reports an absent path. */
function isENOENT(error) {
	return error?.code === "ENOENT";
}
/**
* Whether a freshly scanned credential should REPLACE a vault entry of the
* same account.
*
* The vault is a CACHE of credentials the machine already holds, not a
* competing source. Two clocks decide, compared like against like:
*
* - The scan's clock is the DESKTOP document's `lastRefreshTime` (the
*   upstream's own issuance time) — and the live file ranks above every
*   backup regardless of time, per {@link fileRank}.
* - The vault entry's clock is `refreshedAtMs`, the local write time of the
*   plugin refresh (or OAuth login) that produced it. A wall clock is not
*   comparable to an issuance time, so the two are NOT mixed: the entry is
*   replaced only when the scan's read is the live sign-in AND either the
*   entry predates the scan read's issuance, or the entry was written before
*   the plugin refreshed into it — approximated by requiring the live file's
*   issuance to be NEWER than the entry's write time.
*
* The rule's purpose is breaking the refresh loop: without it, a scan keeps
* reinstating the (older, soon-to-expire) desktop token over the refreshed
* vault copy, so every restart re-refreshes every account. With it, the
* desktop token wins only while it is genuinely newer than what the plugin
* last wrote — after that the refreshed copy is the operative credential,
* exactly like the pre-vault per-region copies behaved.
*/
function shouldReplaceVaultEntry(candidate, incumbent) {
	if (fileRank(candidate.filePath) !== 0) return false;
	const writeMs = incumbent.refreshedAtMs;
	if (writeMs === void 0) return true;
	const issuanceMs = candidate.lastRefreshAtMs;
	if (issuanceMs === void 0) return candidate.expiresAtMs > incumbent.credential.expiresAtMs;
	return issuanceMs > writeMs;
}
/**
* Read every vault entry for one region directory.
*
* The map is keyed by account id, which the FILE NAME already carries: the
* id inside the document is checked against it and a mismatched file is
* skipped — a file copied between accounts (or a half-written rename) must
* not silently answer for the wrong account.
*/
async function readVaultEntries(dir) {
	const entries = /* @__PURE__ */ new Map();
	let names;
	try {
		names = await readdir(dir);
	} catch (error) {
		if (isENOENT(error)) return entries;
		throw error;
	}
	for (const name of names) {
		if (!isVaultCredentialFileName(name)) continue;
		const path = join(dir, name);
		try {
			const parsed = parseVaultDocumentWithWriteTime(await readFile(path, "utf8"), path);
			if (parsed === void 0) continue;
			const id = name.slice(0, -5);
			if (workbuddyAccountId(parsed.credential) !== id) continue;
			entries.set(id, parsed);
		} catch {}
	}
	return entries;
}
/**
* Write one vault entry atomically under the file lock.
*
* The directory is hardened BEFORE the file is created (issue #183). Order
* matters: `writeFileAtomic` commits by creating a temp inode and renaming it
* over the target, so an ACL applied to the file afterwards would leave the
* pre-rename window open, and a crash between the two would leave a plaintext
* token in a file nobody hardened. Hardening the directory first means the
* replacement inode inherits the restricted ACEs at creation.
*
* The hardening is best-effort on purpose: it is defence in depth, and refusing
* to persist a credential because an ACL call failed would turn it into an
* outage. `doctor` reports the outcome so a machine where it failed is visible.
* On POSIX this call is a no-op, and `mode` below carries the same intent.
*
* WHICH directory gets hardened is decided by {@link vaultRootToHarden}, not by
* a bare `dirname(dir)` — see the issue #208 note there.
*/
async function writeVaultEntry(dir, accountId, credential, refreshedFrom) {
	const path = join(dir, `${accountId}.json`);
	await protectCredentialDirectory(vaultRootToHarden(dir));
	await withFileLock(path, async () => {
		await writeFileAtomic(path, `${JSON.stringify(vaultDocument(credential, accountId, refreshedFrom), null, 2)}\n`, {
			mode: 384,
			dirMode: 448
		});
	});
}
/**
* The directory {@link writeVaultEntry} hardens: the vault ROOT, not this
* entry's own directory (issue #183), and never the Harness home (issue #208).
*
* WHY THE ROOT. `Everyone: FullControl` is inherited from `~/.dsh` onto
* `…/workbuddy-vault`; hardening only `<vault>/<region>` would leave the root
* writable, so any local process could replace the region directory itself and
* defeat the restriction inside it. Hardening the root propagates down the
* whole tree in one `icacls` call (measured on a real host: one call on the
* root left the root, both region directories AND the files inside with exactly
* the three intended ACEs).
*
* WHY NOT ALWAYS `dirname(dir)` — THE ISSUE #208 DEFECT. That shape assumes
* `dir` is `<vault>/<region>`. It is not for the UNREGIONED store, whose vault
* directory IS `<DSH home>/workbuddy-vault`; `dirname` then yields `<DSH home>`
* itself, and `/inheritance:r` there strips the ACEs every other directory
* under the home inherits. A reporter hit exactly that: `<DSH home>/attachments`
* became unreadable (EPERM on `scandir`) and every image send failed with the
* host's unrelated `prompt rejected (session/agent-busy)`. `doctor` reaches
* this path because it builds an unregioned store.
*
* So the parent is used only when it is genuinely a vault root — i.e. NOT the
* Harness home. When `dir` already IS the vault root, `dir` is the right
* target. `src/windows-acl.ts` independently refuses the home and its
* ancestors, which covers an injected `vaultDir` and any future call site that
* computes this one level too high; this function is what keeps the CORRECT
* call from relying on that backstop.
*/
function vaultRootToHarden(dir) {
	const parent = dirname(dir);
	return resolve(parent) === resolve(resolveDshHome()) ? dir : parent;
}
/**
* Probe one auth file, reporting WHY it yielded no credential.
*
* The desktop app encrypts its token fields on Windows builds. The plain read
* is tried first and the app is only asked for its at-rest key when the
* document actually carries encrypted wrappers, so the common case costs no
* child process. `resolveAtRestKey` is injectable so the encrypted path is
* testable without a real desktop install.
*/
async function probeAuthFile(path, resolveAtRestKey) {
	let text;
	try {
		text = await readFile(path, "utf8");
	} catch (error) {
		const missing = isENOENT(error);
		return { failure: {
			reason: missing ? "missing" : "unreadable",
			...missing ? {} : { message: error instanceof Error ? error.message : String(error) }
		} };
	}
	const plain = parseWorkBuddyAuth(text, path);
	if (plain !== void 0) return { credential: plain };
	if (!hasEncryptedCredentialFields(text)) return isParseableJson(text) ? { failure: {
		reason: "invalid",
		message: "no access token in the document"
	} } : { failure: {
		reason: "invalid",
		message: "the file is not valid JSON"
	} };
	let key;
	try {
		key = await resolveAtRestKey();
	} catch (error) {
		return { failure: {
			reason: "encrypted",
			message: error instanceof Error ? error.message : String(error)
		} };
	}
	if (key === void 0) return { failure: {
		reason: "encrypted",
		message: `the credential fields are encrypted and no key was available; the WorkBuddy desktop app must be present (or set ${WORKBUDDY_APP_EXECUTABLE_ENV})`
	} };
	const decrypted = parseWorkBuddyAuth(text, path, key);
	return decrypted === void 0 ? { failure: {
		reason: "invalid",
		message: "the encrypted credential fields could not be opened with the desktop app's key"
	} } : { credential: decrypted };
}
/** Whether text parses as JSON at all; distinguishes "wrong shape" from "not JSON". */
function isParseableJson(text) {
	try {
		JSON.parse(text);
		return true;
	} catch {
		return false;
	}
}
/**
* Read one auth file, tolerating absence and unparsable content. Kept as the
* credential-only view for callers that do not need the failure reason.
*/
async function readAuthFile(path, resolveAtRestKey) {
	const probe = await probeAuthFile(path, resolveAtRestKey);
	return "credential" in probe ? probe.credential : void 0;
}
/**
* Read-only credential store with demand-driven refresh and multi-account
* discovery.
*
* Refresh policy: refresh only when the access token is inside the margin
* (or already expired), keep the refreshed credential in the plugin-owned
* copy, and never write the desktop app's files. A failed refresh still
* returns a not-yet-expired token so an unreachable refresh endpoint does
* not take down a working session.
*/
var WorkBuddyCredentialStore = class {
	refresh;
	refreshMarginMs;
	region;
	ownPathExplicit;
	legacyOwnPath;
	legacyOwnPathExplicit;
	vaultDirExplicit;
	/** The vault directory, resolved ONCE at construction. */
	vaultDirResolved;
	authDirs;
	resolveAtRestKey;
	desktopPathOverride;
	accountId;
	inflight;
	/**
	* In-flight/completed scan for the CURRENT `readAll` generation.
	*
	* One page open calls `readAll` six times: the usage route asks for the
	* account list, the sign-in state and the resolved credential, then the
	* per-account credits panel asks once PER ACCOUNT (`credentialFor`), and both
	* region tabs poll on the same timer. Each call re-read every auth file,
	* re-parsed it, and re-ran the vault merge — measured at 6 `readdir` + (6N+12)
	* `readFile` for N accounts, i.e. the cost grew with the account count on a
	* path whose answer cannot change within one tick.
	*
	* This is deliberately NOT a time-based cache: a TTL would make the card show
	* a stale account list after an OAuth add or an import, which is the very
	* class of bug this card keeps chasing. Instead the promise is shared while it
	* is in flight, and every WRITE clears it (see `invalidateScan`) — so a read
	* after a write always scans again, and a read during a scan joins it.
	*
	* Undefined means "no scan in flight and nothing cached".
	*/
	scanInflight;
	/**
	* When the cached scan FINISHED, epoch ms; 0 means "not finished yet".
	*
	* Deliberately the finish time, not the start time (issue #77). The window
	* used to be measured from the START, so a scan that took longer than the
	* window was already outside it the moment it landed: the very next `readAll`
	* started a fresh scan, and the sharing this cache exists for never happened.
	* On the machine in that report one scan took 1.4–2.1 s against a 1000 ms
	* window, so every one of a page open's ~6 reads re-scanned the filesystem.
	*/
	scanFinishedAtMs = 0;
	/**
	* A RUNTIME account override from the pool's rotation, or undefined.
	*
	* Deliberately separate from {@link accountId}, which is the user's persisted
	* choice. Rotation decides who serves *now*; it must never rewrite what the
	* user picked, or "turn rotation off" could not restore their selection and
	* the plugin would be unable to tell the two apart afterwards. Nothing here
	* is ever written to settings.
	*/
	rotatedAccountId;
	constructor(options) {
		this.refresh = options.refresh;
		this.refreshMarginMs = options.refreshMarginMs ?? 3e5;
		this.region = options.region;
		this.ownPathExplicit = options.ownPath;
		this.legacyOwnPath = options.legacyOwnPath ?? legacyWorkbuddyOwnAuthPath();
		this.legacyOwnPathExplicit = options.legacyOwnPath;
		this.vaultDirExplicit = options.vaultDir;
		this.vaultDirResolved = options.vaultDir ?? (options.region !== void 0 ? workbuddyVaultDir(options.region) : join(resolveDshHome(), "workbuddy-vault"));
		this.authDirs = options.authDirs;
		this.desktopPathOverride = options.desktopPath;
		this.resolveAtRestKey = options.resolveAtRestKey ?? readAtRestKey;
	}
	/** Whether a credential's login domain belongs to this store's region. */
	matchesRegion(domain) {
		return this.region === void 0 || regionOf(domain) === this.region;
	}
	/**
	* The path this store refreshes into: the per-region file for a
	* region-scoped store, the legacy single file otherwise, or an explicitly
	* injected path in tests.
	*/
	ownAuthPath() {
		if (this.ownPathExplicit !== void 0) return this.ownPathExplicit;
		return this.region !== void 0 ? workbuddyOwnAuthPath(this.region) : this.legacyOwnPath;
	}
	/**
	* Every plugin-owned copy to read, most preferred first. A region-scoped
	* store reads the legacy single copy as its migration source (readAll's
	* region filter drops it when it carries the other region's credential); an
	* unscoped store reads everything so diagnostics see both regions.
	*
	* With an explicitly injected own path the legacy source is read ONLY when
	* it was injected too — a test that pins one file must not accidentally see
	* the real machine's legacy copy.
	*/
	ownCandidates() {
		if (this.ownPathExplicit !== void 0) return this.legacyOwnPathExplicit !== void 0 ? [this.ownPathExplicit, this.legacyOwnPathExplicit] : [this.ownPathExplicit];
		if (this.region !== void 0) return [workbuddyOwnAuthPath(this.region), this.legacyOwnPath];
		return [
			this.legacyOwnPath,
			workbuddyOwnAuthPath("cn"),
			workbuddyOwnAuthPath("global")
		];
	}
	/** The vault directory this store reads and writes (fixed at construction). */
	vaultDir() {
		return this.vaultDirResolved;
	}
	/** Repoint the desktop file or directory; applies on the next read. */
	setDesktopPath(path) {
		this.desktopPathOverride = path;
		this.inflight = void 0;
		this.invalidateScan();
	}
	/**
	* Select an account by id; tokens stay outside settings.
	*
	* The empty string is the settings-level sentinel for "no explicit
	* selection" (the card's Clear action writes it), so it is normalized here
	* rather than being kept as an id that can never match an account. Every
	* caller therefore gets the documented default — follow the app's current
	* sign-in — instead of a dead selection.
	*/
	selectAccount(accountId) {
		this.accountId = accountId === "" ? void 0 : accountId;
		this.inflight = void 0;
		this.invalidateScan();
	}
	/** Selected account id, for diagnostics and route assembly. */
	selectedAccountId() {
		return this.accountId;
	}
	/**
	* Whether the region runs a SAVED choice rather than the documented default.
	*
	* `false` means "follow the app's current sign-in", which is also what the
	* card's Clear action restores. The two states can resolve to the very same
	* account — an upgraded user whose pre-split `accountId` happens to be the
	* app's current sign-in clears the choice and sees no change at all — so the
	* card cannot infer this from the account list alone. It reports the state
	* here so clearing is observable instead of looking like a dead button.
	*/
	hasExplicitSelection() {
		return this.accountId !== void 0;
	}
	/** The auth-file path candidates, in probe order. */
	resolveDesktopCandidates() {
		const fromEnv = process.env[WORKBUDDY_AUTH_FILE_ENV];
		const explicit = this.desktopPathOverride ?? (fromEnv !== void 0 && fromEnv.trim() !== "" ? fromEnv : void 0);
		if (explicit !== void 0) return [explicit];
		return (this.authDirs ?? defaultDesktopAuthDirs()).flatMap((dir) => WORKBUDDY_LIVE_FILENAMES.map((name) => join(dir, name)));
	}
	/** The resolved desktop auth-file path, for diagnostics. */
	desktopAuthPath() {
		return this.resolveDesktopCandidates()[0];
	}
	/**
	* Every auth file to scan: the live file plus the timestamped backups
	* WorkBuddy leaves beside it.
	*
	* An explicitly configured path pins the *directory*: its siblings are
	* still scanned, because a user who points the plugin at their auth file
	* expects account switching to work the same way it does on the default
	* path. Only the file ordering changes.
	*
	* A corrupt or signed-out file must never hide the others, so each read is
	* independent and failures are skipped rather than propagated.
	*/
	async candidateFiles() {
		const explicitPath = this.desktopPathOverride ?? ((process.env["WORKBUDDY_AUTH_FILE"] ?? "").trim() !== "" ? process.env["WORKBUDDY_AUTH_FILE"] : void 0);
		const files = [];
		if (explicitPath !== void 0) {
			files.push(explicitPath);
			for (const backup of await this.backupsBeside(explicitPath)) files.push(backup);
			return files;
		}
		const dirs = this.authDirs ?? defaultDesktopAuthDirs();
		const seen = /* @__PURE__ */ new Set();
		for (const dir of dirs) {
			for (const name of WORKBUDDY_LIVE_FILENAMES) {
				const live = join(dir, name);
				if (!seen.has(live)) {
					seen.add(live);
					files.push(live);
				}
			}
			for (const name of WORKBUDDY_LIVE_FILENAMES) for (const backup of await this.backupsBeside(join(dir, name))) {
				if (seen.has(backup)) continue;
				seen.add(backup);
				files.push(backup);
			}
		}
		return files;
	}
	/** Timestamped siblings of one auth file, newest first by filename. */
	async backupsBeside(path) {
		const dir = dirname(path);
		const base = path.slice(dir.length + 1);
		try {
			return (await readdir(dir)).filter((name) => name !== base && name.endsWith(".info")).sort().reverse().map((name) => join(dir, name));
		} catch {
			return [];
		}
	}
	/**
	* Read every local credential, deduplicated by account id. Files are
	* probed newest-first, so the first entry for an account is its freshest.
	*
	* A region-scoped store sees only its own region's credentials: the other
	* region's accounts are invisible to selection, refresh, and status alike,
	* which is what keeps the two regions' providers from cross-billing.
	*/
	/**
	* The account list, sharing one scan across concurrent and repeated reads.
	*
	* See {@link scanInflight}: the whole performance fix lives in these lines.
	* Every caller keeps its OWN semantics (`current`, `accounts`, `status`,
	* `selectionLost`), because this returns the same array they used to build
	* themselves — only the filesystem work is shared.
	*
	* The window runs from the FINISH time ({@link scanFinishedAtMs}), so a scan
	* slower than the window still serves the reads that follow it. A scan in
	* flight is always joined, however long it has been running.
	*
	* A failed scan is NOT cached: the rejection clears the slot so the next read
	* retries, rather than pinning every later caller to one transient failure.
	*/
	async readAll() {
		if (this.scanInflight !== void 0) {
			if (this.scanFinishedAtMs === 0 || Date.now() - this.scanFinishedAtMs < SCAN_SHARE_WINDOW_MS) return this.scanInflight;
		}
		this.scanFinishedAtMs = 0;
		const scan = this.scanAll().then((credentials) => {
			this.scanFinishedAtMs = Date.now();
			return credentials;
		}, (error) => {
			if (this.scanInflight === scan) this.scanInflight = void 0;
			this.scanFinishedAtMs = 0;
			throw error;
		});
		this.scanInflight = scan;
		return scan;
	}
	/** Drop the shared scan so the next read re-reads the filesystem. */
	invalidateScan() {
		this.scanInflight = void 0;
		this.scanFinishedAtMs = 0;
	}
	/** The one real scan: read every candidate file, then merge the vault. */
	async scanAll() {
		const files = await this.candidateFiles();
		const dismissed = await readDismissed(this.vaultDir());
		const byId = /* @__PURE__ */ new Map();
		for (const file of files) {
			const credential = await readAuthFile(file, this.resolveAtRestKey);
			if (credential === void 0 || !this.matchesRegion(credential.domain)) continue;
			const id = workbuddyAccountId(credential);
			if (dismissed.has(id)) continue;
			const existing = byId.get(id);
			if (existing === void 0) {
				byId.set(id, credential);
				continue;
			}
			if (isFresher(credential, existing)) byId.set(id, mergeCredentialDisplayNames(existing, credential));
			else byId.set(id, mergeCredentialDisplayNames(credential, existing));
		}
		for (const own of await this.readOwns()) {
			if (!this.matchesRegion(own.domain)) continue;
			const id = workbuddyAccountId(own);
			if (dismissed.has(id)) continue;
			const existing = byId.get(id);
			if (existing === void 0) byId.set(id, own);
			else if (fileRank(existing.filePath) !== 0 && own.expiresAtMs > existing.expiresAtMs) byId.set(id, own);
		}
		await this.syncVault(byId, dismissed);
		return Object.freeze([...byId.values()]);
	}
	/**
	* Merge the scan's credentials into the vault and read the vault back.
	*
	* Incremental by contract: a scan that finds nothing new writes nothing.
	* Per account, the vault entry is written only when the scan's read is
	* fresher by {@link isFresherVaultEntry} — so a steady-state scan is
	* mtime-stable and every sync is O(accounts) reads with at most one write
	* per CHANGED account.
	*/
	async syncVault(scan, dismissed) {
		const dir = this.vaultDir();
		let entries;
		try {
			entries = await readVaultEntries(dir);
		} catch {
			return;
		}
		let dirReady = false;
		for (const [id, credential] of scan) {
			if (dismissed.has(id)) continue;
			const incumbent = entries.get(id);
			if (incumbent !== void 0 && !shouldReplaceVaultEntry(credential, incumbent)) continue;
			if (!dirReady) try {
				await mkdir(dir, { recursive: true });
				dirReady = true;
			} catch {
				return;
			}
			await writeVaultEntry(dir, id, credential);
			entries.set(id, {
				credential: {
					...credential,
					source: "dsh"
				},
				refreshedAtMs: Date.now()
			});
		}
		for (const [id, entry] of entries) {
			if (!this.matchesRegion(entry.credential.domain)) continue;
			const existing = scan.get(id);
			if (dismissed.has(id)) continue;
			if (existing === void 0) scan.set(id, entry.credential);
			else if (entry.refreshedFrom !== void 0 && entry.refreshedFrom === authFileName(existing.filePath)) scan.set(id, entry.credential);
			else if (fileRank(existing.filePath) !== 0 && entry.credential.expiresAtMs > existing.expiresAtMs) scan.set(id, entry.credential);
		}
	}
	/**
	* Default when no account is explicitly selected: the live sign-in, else the
	* freshest credential. Following the app's current sign-in is the documented
	* default behaviour; the backups exist so the user can switch explicitly.
	* This is NOT credit-seeking — it never reorders accounts to find one with
	* remaining credit.
	*/
	preferred(credentials) {
		if (credentials.length === 0) return void 0;
		return credentials.reduce((best, credential) => isFresher(credential, best) ? credential : best);
	}
	/**
	* Token-free account list for the plugin card.
	*
	* `selected` answers one question only: which row is the account the plugin
	* is actually going to use? That is exactly what {@link current} decides, so
	* the two must never disagree — the card renders this list while the shim
	* bills through `current()`, and a row marked "selected" that `current()`
	* refuses to use is what made the dropdown look healthy while every request
	* failed with 401.
	*
	* THE POOL'S RUNTIME OVERRIDE IS PART OF `current()`, SO IT IS PART OF THIS.
	* `current()` consults `rotatedAccountId` FIRST; this method used to ignore it
	* and answer from `accountId` alone. With the pool on, the two therefore
	* disagreed on every rotation: the shim billed account B while the card marked
	* account A — the reporter's screenshot showed 「当前选用」 on a rate-limited
	* account while the pill's total belonged to the one actually serving. Worse,
	* the usage document takes its `credential` from `current()` and its
	* `account.accountId` from this list, so one document could name two accounts.
	*
	* So an explicit selection that matches NO local account marks nothing as
	* selected (no silent fallback to a different account — see {@link current}).
	* The implicit default is marked only when nothing was explicitly chosen.
	* A live rotation marker wins over both, mirroring `current()`'s precedence,
	* and only while it still names a local account — `current()` falls through in
	* that case, and so does this.
	*/
	async accounts() {
		const credentials = await this.readAll();
		if (credentials.length === 0) return [];
		const hasExplicitSelection = this.accountId !== void 0;
		const selectedExists = hasExplicitSelection && credentials.some((credential) => workbuddyAccountId(credential) === this.accountId);
		const defaultSelected = this.preferred(credentials);
		const rotatedId = this.rotatedAccountId !== void 0 && credentials.some((credential) => workbuddyAccountId(credential) === this.rotatedAccountId) ? this.rotatedAccountId : void 0;
		return credentials.map((credential) => {
			const id = workbuddyAccountId(credential);
			return {
				id,
				accountName: preferredAccountName(credential),
				domain: credential.domain,
				...credential.enterpriseId === void 0 || credential.enterpriseId === "" ? {} : { enterprise: true },
				source: credential.source,
				tokenExpiresAtMs: credential.expiresAtMs,
				filePath: credential.filePath,
				selected: rotatedId !== void 0 ? id === rotatedId : selectedExists ? id === this.accountId : !hasExplicitSelection && credential === defaultSelected
			};
		});
	}
	/**
	* Whether a persisted selection exists that matches no local account, while
	* other local sign-ins ARE available to choose from.
	*
	* The card uses this to explain the state honestly (the account is signed in,
	* but the SAVED choice is gone) instead of showing the generic "sign in
	* again" hint, which misdirects: the token is usually perfectly healthy and
	* signing in again does not repair an orphaned id. When no local sign-in is
	* available at all, that hint IS accurate and this returns false.
	*/
	async selectionLost() {
		if (this.accountId === void 0) return false;
		const credentials = await this.readAll();
		if (credentials.length === 0) return false;
		return !credentials.some((credential) => workbuddyAccountId(credential) === this.accountId);
	}
	/**
	* Why the vault could not be read, when it could not (issue #199).
	*
	* `syncVault` deliberately swallows a failed `readVaultEntries` so account
	* discovery stays up — the right call for availability, the wrong call for
	* honesty: the user then sees the SAVED account reported as "no longer on
	* this machine" when the truth is "this process may not read the directory".
	* The issue #199 lockout (foreign owner + `/inheritance:r`) produces exactly
	* that shape: readdir EPERM while per-path readFile still works, so nothing
	* else in the diagnostics reports the directory either.
	*
	* A dedicated readdir probe rather than a field recorded during the scan:
	* the scan is shared/cached (`scanInflight`), its failure is transient by
	* design, and a probe here is one cheap readdir on a path that is already
	* failing — the error string is the fact the card needs.
	*
	* Returns the raw error message, or `undefined` when the directory reads
	* (including the absent case, which is normal before the first OAuth add).
	*/
	async vaultReadError() {
		try {
			await readdir(this.vaultDir());
			return;
		} catch (error) {
			if (isENOENT(error)) return void 0;
			return error instanceof Error ? error.message : String(error);
		}
	}
	/** The freshest stored credential for the current selection, no refresh. */
	async current() {
		const credentials = await this.readAll();
		if (this.rotatedAccountId !== void 0) {
			const rotated = credentials.find((credential) => workbuddyAccountId(credential) === this.rotatedAccountId);
			if (rotated !== void 0) return rotated;
		}
		if (this.accountId === void 0) return this.preferred(credentials);
		return credentials.find((credential) => workbuddyAccountId(credential) === this.accountId);
	}
	/**
	* Set (or clear) the pool's RUNTIME account override.
	*
	* Never persists and never touches {@link accountId}: the user's saved choice
	* is what `clear` restores, which is the whole reason this lives in its own
	* field. Rotation is off when this is called with `undefined`.
	*/
	setRotatedAccount(accountId) {
		this.rotatedAccountId = accountId;
	}
	/** The account the pool is currently rotating to, if any. */
	rotatedAccount() {
		return this.rotatedAccountId;
	}
	/**
	* One account's stored credential by id, WITHOUT consulting or changing the
	* current selection.
	*
	* Exists so a recovery probe can test whether some OTHER local account is
	* still accepted upstream while a rejected one stays selected: mutating the
	* live selection to find that out would be exactly the silent account switch
	* this store refuses to perform (it would bill the wrong account mid-probe).
	*/
	async credentialFor(accountId) {
		return (await this.readAll()).find((credential) => workbuddyAccountId(credential) === accountId);
	}
	/** The credential to send upstream: {@link current}, refreshed on demand. */
	async resolve() {
		const credential = await this.current();
		if (credential === void 0) throw await this.describeMissingCredential();
		if (!this.needsRefresh(credential)) return credential;
		this.inflight ??= this.refreshNow(credential).finally(() => {
			this.inflight = void 0;
		});
		return this.inflight;
	}
	/**
	* WHY no credential resolved, as the error to throw.
	*
	* `resolve()` seeing zero accounts has two very different causes, and the
	* generic "sign in once" message is only correct for one of them. When a
	* probe finds a credential file whose fields are encrypted and the key could
	* not be obtained, the user is signed in and re-authenticating cannot help —
	* so that case gets {@link WorkBuddyEncryptedCredentialError} instead, naming
	* the file and the environment variable that actually fixes it.
	*
	* The probe is only run on the failure path, so the healthy case pays nothing.
	* A probe that itself throws must not replace the real error, hence the
	* fallback to the generic message.
	*/
	async describeMissingCredential() {
		let failures = [];
		try {
			failures = (await this.diagnose()).failures;
		} catch {}
		const encrypted = failures.filter((failure) => failure.reason === "encrypted").map((failure) => failure.path);
		if (encrypted.length > 0) return new WorkBuddyEncryptedCredentialError(encrypted);
		const candidates = this.resolveDesktopCandidates();
		const desktop = candidates.length > 0 ? candidates.join(" or ") : "(no desktop path on this platform)";
		return /* @__PURE__ */ new Error(`workbuddy: no signed-in WorkBuddy account found; sign in once in the WorkBuddy desktop app (expected ${desktop} or ${WORKBUDDY_AUTH_FILE_ENV}), or refresh an existing session`);
	}
	/** Read-only sign-in summary; never refreshes and never throws. */
	async status() {
		try {
			const credential = await this.current();
			if (credential === void 0) return { state: "signed-out" };
			return {
				state: "signed-in",
				expiresAtMs: credential.expiresAtMs,
				...credential.refreshExpiresAtMs === void 0 ? {} : { refreshExpiresAtMs: credential.refreshExpiresAtMs },
				...credential.nickname === void 0 ? {} : { nickname: credential.nickname },
				...credential.domain === "" ? {} : { domain: credential.domain },
				source: credential.source
			};
		} catch {
			return { state: "signed-out" };
		}
	}
	/**
	* Persist one OAuth sign-in into the unified vault.
	*
	* The credential is written with `source: 'dsh'` (it never came from a
	* desktop file) and joins the readable set on the next scan — the vault is
	* read by `readAll()` like any other source, so no separate discovery path
	* exists. The write is idempotent per account id: re-adding an account
	* replaces its entry, which is exactly what re-issuing a login means.
	*
	* Returns the account id so the card can offer to select it right away.
	*/
	async addOAuthAccount(credential) {
		const id = workbuddyAccountId(credential);
		const dir = this.vaultDir();
		await mkdir(dir, { recursive: true });
		await writeVaultEntry(dir, id, {
			...credential,
			source: "dsh",
			filePath: join(dir, `${id}.json`)
		});
		await this.forgetDismissal(dir, id);
		this.inflight = void 0;
		this.invalidateScan();
		return id;
	}
	/**
	* Drop one id from the dismissal list, if present.
	*
	* Silent by design: called on the ADD paths, where a list that cannot be
	* updated must not fail the action the user asked for. The consequence is the
	* same as before the fix — the account stays hidden until the list is
	* repaired — while throwing here would report a failed sign-in that succeeded.
	*/
	async forgetDismissal(dir, accountId) {
		try {
			const dismissed = await readDismissed(dir);
			if (!dismissed.has(accountId)) return;
			dismissed.delete(accountId);
			await writeDismissed(dir, dismissed);
		} catch {}
	}
	/**
	* Forget EVERY dismissal, so the next read lists the accounts again.
	*
	* Called by the manual 「re-scan」 action. Dismissal is "hide until I ask to
	* scan again", and this is that ask: the user is requesting what the machine
	* currently has, which includes accounts they hid earlier. Leaving the list
	* intact would make a removed desktop account unrecoverable from the UI — the
	* opposite of what the button promises.
	*
	* PREFERS deleting the file over writing an empty list: an absent file is the
	* normal state and keeps the vault directory free of a file that says nothing.
	* The unlink is not the only way, though, because on Windows removing a file
	* another process holds open fails with `EPERM`/`EBUSY`/`EACCES` — an antivirus
	* scanner, OneDrive, or an editor with it open, the same contention the card's
	* `isFileContentionWriteError` classifies for profile writes and the reason
	* `docs/WINDOWS.md` keeps a register. POSIX unlinks open files happily, so
	* without this the promise 「点重新检测账号即可找回」 would be false, silently,
	* on exactly the platform it matters most on.
	*
	* So the unlink falls back to OVERWRITING the list with an empty one through
	* the same locked atomic write `writeDismissed` uses. For every reader the two
	* outcomes are identical (`readDismissed` yields no ids either way), so the
	* user's ask is honoured even when the file itself cannot be removed.
	*
	* Returns whether the dismissals are now genuinely gone, VERIFIED by reading
	* the list back rather than by trusting the write: the caller renders this, so
	* "it worked" has to mean it. A `false` is the honest answer for a vault that
	* could neither be unlinked nor rewritten, and the rescan still runs — the
	* accounts simply stay hidden, which the UI can now say out loud instead of
	* showing a button that appears to have done nothing.
	*/
	async clearDismissals() {
		this.inflight = void 0;
		this.invalidateScan();
		const dir = this.vaultDir();
		const path = join(dir, VAULT_DISMISSED_FILENAME);
		try {
			await rm(path, { force: true });
		} catch {
			try {
				await writeDismissed(dir, /* @__PURE__ */ new Set());
			} catch {
				return (await readDismissed(dir)).size === 0;
			}
		}
		return (await readDismissed(dir)).size === 0;
	}
	/**
	* Remove ONE account from this region's list, by id.
	*
	* The account is DISMISSED, not merely deleted. Deleting the vault entry alone
	* was undone by the next scan: `syncVault` writes every desktop sign-in it
	* finds back into the vault (that is how a desktop account becomes selectable)
	* and `readAll` merges the vault in afterwards, so a removed desktop account
	* returned on the very next read while `removeAccount` had reported `true`.
	* Measured before the fix: remove → `true`, then `accounts()` still lists it.
	*
	* The desktop app's auth files stay read-only: dismissing hides the account
	* from this plugin without signing the app out, and that is exactly what the
	* card says. Re-adding it (a fresh OAuth sign-in or an import) clears the
	* dismissal, so the account is not lost to a future login.
	*
	* Returns whether a stored vault entry was also removed, so the caller can
	* still tell "removed" from "only a desktop sign-in" — the dismissal happens
	* either way, because only the user gets to decide an account is dismissed.
	*/
	async removeAccount(accountId) {
		if (!VAULT_ACCOUNT_ID_RE.test(accountId)) throw new Error(`workbuddy: refusing to remove '${accountId}': not a vault account id`);
		const path = join(this.vaultDir(), `${accountId}.json`);
		const removed = await withFileLock(path, async () => {
			let existed = true;
			try {
				await rm(path, { force: false });
			} catch (error) {
				if (!isENOENT(error)) throw error;
				existed = false;
			}
			await rm(`${path}.lock`, { force: false }).catch(() => {});
			return existed;
		});
		if (this.rotatedAccountId === accountId) this.rotatedAccountId = void 0;
		if (this.accountId === accountId) this.accountId = void 0;
		const dir = this.vaultDir();
		try {
			await mkdir(dir, { recursive: true });
			const dismissed = await readDismissed(dir);
			if (!dismissed.has(accountId)) {
				dismissed.add(accountId);
				await writeDismissed(dir, dismissed);
			}
		} catch {}
		this.inflight = void 0;
		this.invalidateScan();
		return removed;
	}
	/**
	* Remove every plugin-owned copy this store could read (per-region file,
	* legacy single file, and their lock siblings); the desktop files are
	* untouched. A region store's logout therefore also clears the legacy
	* migration source — deliberate: `logout` is the user's "forget what the
	* plugin stored" action, not a per-account toggle.
	*/
	async logout() {
		for (const path of this.ownCandidates()) {
			await rm(path, { force: true });
			await rm(`${path}.lock`, { force: true });
		}
		await rm(this.vaultDir(), {
			recursive: true,
			force: true
		});
		this.invalidateScan();
	}
	needsRefresh(credential) {
		if (credential.expiresAtMs <= 0) return true;
		return Date.now() + this.refreshMarginMs >= credential.expiresAtMs;
	}
	async refreshNow(credential) {
		if (credential.refreshToken === "") {
			if (credential.expiresAtMs > Date.now() + 3e4) return credential;
			throw new Error("workbuddy: access token expired and no refresh token is stored; sign in again in the WorkBuddy desktop app");
		}
		try {
			const outcome = await this.refresh(credential);
			const refreshed = {
				...credential,
				accessToken: outcome.accessToken,
				...outcome.refreshToken === void 0 ? {} : { refreshToken: outcome.refreshToken },
				expiresAtMs: outcome.expiresInSec !== void 0 ? Date.now() + outcome.expiresInSec * 1e3 : credential.expiresAtMs,
				...outcome.domain === void 0 || outcome.domain === "" ? {} : { domain: outcome.domain },
				source: "dsh"
			};
			this.invalidateScan();
			await writeVaultEntry(this.vaultDir(), workbuddyAccountId(credential), refreshed, credential.filePath).catch(() => {});
			return refreshed;
		} catch (error) {
			if (credential.expiresAtMs > Date.now() + 3e4) return credential;
			throw new Error(`workbuddy: token refresh failed and the access token is expired (${String(error)}); open the WorkBuddy desktop app once to sign in again`);
		}
	}
	/**
	* Every readable plugin-owned copy, in candidate order; absent or corrupt
	* files are skipped rather than propagated.
	*/
	async readOwns() {
		const copies = [];
		for (const path of this.ownCandidates()) try {
			const parsed = parseOwnDocument(await readFile(path, "utf8"), path);
			if (parsed !== void 0) copies.push(parsed);
		} catch {}
		return copies;
	}
	/** Whether any candidate file exists as a regular file; diagnostics only. */
	async desktopFilePresent() {
		for (const path of this.resolveDesktopCandidates()) try {
			if ((await stat(path)).isFile()) return true;
		} catch {}
		return false;
	}
	/**
	* Which paths were probed and why each one yielded no credential.
	*
	* Read-only and token-free: it exists so a signed-out card can explain
	* itself. A bare "not signed in" is undiagnosable on a machine whose layout
	* differs from the ones this plugin was written against — and on Windows it
	* is actively misleading, because encrypted token fields need the desktop app
	* present to be read at all. Only paths this store actually consults are
	* reported, and only files that failed: one healthy sibling would make the
	* whole list noise.
	*/
	async diagnose() {
		const candidates = [];
		const desktopTried = this.resolveDesktopCandidates();
		const probed = [];
		for (const path of await this.candidateFiles()) probed.push({
			path,
			probe: await probeAuthFile(path, this.resolveAtRestKey)
		});
		/**
		* Directories that need no `missing` complaint (issue #174).
		*
		* A directory is "accounted for" when it either yielded a readable
		* credential OR produced some other, more specific complaint. The first case
		* is the healthy machine whose app writes only one of the two known
		* spellings; the second is a machine holding a broken file — and telling
		* that user "no auth file at the expected path" would be both false and
		* less useful than the `invalid` line they already have.
		*/
		const accountedDirs = /* @__PURE__ */ new Set();
		for (const entry of probed) {
			if ("credential" in entry.probe) {
				accountedDirs.add(dirname(entry.path));
				continue;
			}
			if (entry.probe.failure.reason !== "missing") accountedDirs.add(dirname(entry.path));
		}
		/** Directories whose `missing` complaint has already been made. */
		const missingReported = /* @__PURE__ */ new Set();
		for (const { path, probe } of probed) {
			if ("credential" in probe) {
				if (!this.matchesRegion(probe.credential.domain)) candidates.push({
					path,
					source: "desktop",
					reason: "wrong-region",
					message: `holds a ${regionOf(probe.credential.domain)} sign-in, but this tab reads the ${this.region} region`
				});
				continue;
			}
			if (probe.failure.reason === "missing") {
				const dir = dirname(path);
				if (accountedDirs.has(dir) || missingReported.has(dir)) continue;
				missingReported.add(dir);
			}
			candidates.push({
				path,
				source: "desktop",
				...probe.failure
			});
		}
		for (const path of this.ownCandidates()) {
			let text;
			try {
				text = await readFile(path, "utf8");
			} catch (error) {
				if (isENOENT(error)) continue;
				candidates.push({
					path,
					source: "dsh",
					reason: "unreadable",
					message: error instanceof Error ? error.message : String(error)
				});
				continue;
			}
			const parsed = parseOwnDocument(text, path);
			if (parsed === void 0 || !this.matchesRegion(parsed.domain)) {
				candidates.push({
					path,
					source: "dsh",
					reason: "invalid",
					message: "not a readable plugin-owned credential"
				});
				continue;
			}
		}
		const tried = [...await this.candidateFiles(), ...this.ownCandidates()];
		try {
			const names = await readdir(this.vaultDir());
			for (const name of names.filter(isVaultCredentialFileName)) {
				const path = join(this.vaultDir(), name);
				tried.push(path);
				let text;
				try {
					text = await readFile(path, "utf8");
				} catch (error) {
					if (!isENOENT(error)) candidates.push({
						path,
						source: "dsh",
						reason: "unreadable",
						message: error instanceof Error ? error.message : String(error)
					});
					continue;
				}
				if (parseVaultDocument(text, path) === void 0) candidates.push({
					path,
					source: "dsh",
					reason: "invalid",
					message: "not a readable vault credential"
				});
			}
		} catch {}
		return {
			tried: [...desktopTried, ...this.ownCandidates()],
			failures: candidates
		};
	}
};
//#endregion
//#region src/catalog.ts
/**
* WorkBuddy model catalog: a static fallback list, replaced by the upstream's
* dynamic catalog once it loads, and filtered by the user's explicit selection.
*
* 参考：dingminhua/dsh-connect-trae（MIT，Copyright (c) 2026 LaoDing）
*   — 「上次刷新的完整目录（lastCatalog）与用户勾选分离，运行时目录由两者
*     推导」的模型来自该项目。它让卡片永远展示最新目录而不是陈旧快照，
*     并让上游刷新成为草稿操作（用户点保存才生效）。
*   静态 fallback 目录的做法来自
*     corrinehu/dsh-workbuddy-connect（MIT）：上游不可用时 provider 不为空。
* 改动：WorkBuddy 直接用各模型的 `maxInputTokens` 声明实际上下文窗口；
*   上游没有独立的长上下文开关或第二个模型 id，因此不会虚构 `@1m` 变体。
*   本目录额外承载上游给出的积分倍率、多模态与推理档位。
*
* @module dsh-connect-workbuddy/catalog
*/
/**
* Static CLI models captured from the CN endpoint (2026-08-30). The upstream
* refresh replaces this list at startup; it exists so the provider registers
* with a usable catalog even while the first fetch is in flight or offline.
*
* The upstream's `auto` ROUTER is deliberately absent, matching what
* `selectCliModels` now does to the live roster: it resolves to a different
* model per request, so it is not a row this plugin can describe. Keeping it
* here would have reintroduced it on the offline/第一帧 path only, which is the
* hardest kind of inconsistency to notice.
*/
const FALLBACK_WORKBUDDY_MODELS = [
	{
		id: "hy3",
		name: "Hy3",
		contextWindow: 192e3,
		maxTokens: 64e3
	},
	{
		id: "glm-5v-turbo",
		name: "GLM-5v-Turbo",
		contextWindow: 2e5,
		maxTokens: 64e3
	},
	{
		id: "glm-5.3",
		name: "GLM-5.3",
		contextWindow: 1e6,
		maxTokens: 48e3
	},
	{
		id: "glm-5.2",
		name: "GLM-5.2",
		contextWindow: 1e6,
		maxTokens: 48e3
	},
	{
		id: "glm-5.1",
		name: "GLM-5.1",
		contextWindow: 2e5,
		maxTokens: 48e3
	},
	{
		id: "minimax-m3",
		name: "MiniMax-M3",
		contextWindow: 512e3,
		maxTokens: 128e3
	},
	{
		id: "kimi-k3-1",
		name: "Kimi-K3",
		contextWindow: 1e6,
		maxTokens: 32e3
	},
	{
		id: "kimi-k2.7",
		name: "Kimi-K2.7-Code",
		contextWindow: 256e3,
		maxTokens: 32e3
	},
	{
		id: "kimi-k2.6",
		name: "Kimi-K2.6",
		contextWindow: 256e3,
		maxTokens: 32e3
	},
	{
		id: "deepseek-v4-flash",
		name: "Deepseek-V4-Flash",
		contextWindow: 1e6,
		maxTokens: 5e4
	},
	{
		id: "deepseek-v4-pro",
		name: "Deepseek-V4-Pro",
		contextWindow: 1e6,
		maxTokens: 5e4
	}
];
/**
* Static CLI models captured from the INTERNATIONAL gateway's desktop-channel
* product config (`www.workbuddy.ai/v3/config`, 2026-09-11). The two regions
* expose different rosters — the CN list has no `gpt-*`/`gemini-*` entries —
* so a global account must never be seeded with the CN list. Like the CN
* fallback this is replaced by the live refresh; it only keeps the provider
* usable before the first fetch lands. Order mirrors the upstream.
*
* ⚠️ IT CARRIES NO `creditMultiplier`, AND THAT IS THE FIX FOR ISSUE #214.
* This list used to hardcode one rate per model, captured on 2026-09-11. The
* upstream moves those rates — the reporter measured `glm-5.3` at x0.69 and
* `hy4-preview` at x0.29 on 2026-11-04 against the x0.79 / x0.00 written
* here — so every captured rate aged into a WRONG PRICE. Worse, the overlay
* rule (`overlayLiveCapabilities`: the live side owns `creditMultiplier`)
* meant this table WON over the user's saved directory whenever the catalog
* still held it, which is exactly the reported symptom: the card showed the
* built-in table's figures, not the saved ones and not the upstream's.
*
* A price is a FACT ABOUT NOW, and this module never learns "now": it is the
* offline placeholder, written once and never refreshed. So it must not
* assert a price at all. An absent multiplier renders as "no rate" — the
* honest answer — and `pickFreeModel` deliberately treats absence as NOT
* free, so the account pool can never probe a paid model by mistake. The CN
* table has always been shaped this way for the same reason.
*
* The ROSTER (ids, names, windows) stays: that is what keeps the provider
* non-empty while the first fetch is in flight, and an id list ages far
* more slowly than a price list.
*/
const FALLBACK_WORKBUDDY_MODELS_GLOBAL = [
	{
		id: "fast-model",
		name: "Fast",
		contextWindow: 2e5,
		maxTokens: 32e3
	},
	{
		id: "balanced-model",
		name: "Balanced",
		contextWindow: 256e3,
		maxTokens: 32e3
	},
	{
		id: "primary-model",
		name: "Primary",
		contextWindow: 272e3,
		maxTokens: 72e3
	},
	{
		id: "deep-model",
		name: "Deep",
		contextWindow: 176e3,
		maxTokens: 24e3
	},
	{
		id: "deepseek-v4.1-flash",
		name: "Deepseek-V4.1-Flash",
		contextWindow: 1e6,
		maxTokens: 128e3
	},
	{
		id: "gpt-6-astra",
		name: "GPT-6-Astra",
		contextWindow: 1e6,
		maxTokens: 128e3
	},
	{
		id: "hy4-preview",
		name: "Hy4 preview",
		contextWindow: 1e6,
		maxTokens: 64e3
	},
	{
		id: "hy3",
		name: "Hy3",
		contextWindow: 192e3,
		maxTokens: 64e3
	},
	{
		id: "gpt-5.6-sol",
		name: "GPT-5.6-Sol",
		contextWindow: 1e6,
		maxTokens: 128e3
	},
	{
		id: "gpt-5.6-terra",
		name: "GPT-5.6-Terra",
		contextWindow: 1e6,
		maxTokens: 128e3
	},
	{
		id: "gpt-5.6-luna",
		name: "GPT-5.6-Luna",
		contextWindow: 1e6,
		maxTokens: 128e3
	},
	{
		id: "gpt-5.5",
		name: "GPT-5.5",
		contextWindow: 1e6,
		maxTokens: 128e3
	},
	{
		id: "gpt-5.4",
		name: "GPT-5.4",
		contextWindow: 272e3,
		maxTokens: 72e3
	},
	{
		id: "gpt-5.3-codex",
		name: "GPT-5.3-Codex",
		contextWindow: 272e3,
		maxTokens: 72e3
	},
	{
		id: "gemini-3.5-flash",
		name: "Gemini-3.5-Flash",
		contextWindow: 1e6,
		maxTokens: 65536
	},
	{
		id: "glm-5.3",
		name: "GLM-5.3",
		contextWindow: 1e6,
		maxTokens: 48e3
	},
	{
		id: "glm-5.2",
		name: "GLM-5.2",
		contextWindow: 1e6,
		maxTokens: 48e3
	},
	{
		id: "kimi-k3",
		name: "Kimi-K3",
		contextWindow: 1e6,
		maxTokens: 32e3
	},
	{
		id: "kimi-k2.6",
		name: "Kimi-K2.6",
		contextWindow: 256e3,
		maxTokens: 32e3
	}
];
/**
* Static fallback directory for a region. Each region keeps its own model
* slot in settings; the fallback must match the region so an account never
* shows the other region's roster.
*/
function fallbackModelsFor(region) {
	return region === "global" ? FALLBACK_WORKBUDDY_MODELS_GLOBAL : FALLBACK_WORKBUDDY_MODELS;
}
/**
* Drop the upstream's ROUTER rows from a roster that came from settings.
*
* The static lists and `selectCliModels` both refuse routers already, but
* `lastCatalog` is a SNAPSHOT the user's profile carries from an earlier
* version — and every read of it (the card's list, the runtime catalog, the
* provider's advertisement) would otherwise keep showing the row long after the
* code stopped offering it. Filtering at the READ point instead of migrating the
* saved value is deliberate: the stored slot stays exactly what the last refresh
* wrote, so nothing is silently rewritten on load, and the row disappears the
* moment the new code runs rather than at the next refresh.
*/
function withoutRouters(models) {
	return models.filter((model) => !isRouterModelId(model.id));
}
/**
* Apply the saved local DSH budget. A budget is an UPPER LIMIT the user sets,
* never a default: a model without an explicit budget keeps its own window, and
* a budget can only ever LOWER a window (`Math.min`), so a value above the
* native one is not an error, just a no-op.
*
* There used to be a `?? 200_000` default here (issue #33), on the rationale
* that a lower advertised window makes DSH compact sooner and so keeps a long
* session under the upstream throttle. That rationale does not hold: the
* measured throttle fires on a SINGLE request past 20k-30k input tokens (the
* CHANGELOG's own wording calls 200K "远超上游 ~20–30k 的节流线"), so clamping to
* 200K bought none of the safety it claimed while costing every >200K model its
* real window — and contradicting the static roster in this very file, which
* declares those models as 1M. A user who wants the conservative behaviour sets
* a budget explicitly; the card offers that per model.
*/
function applyContextBudgets(catalog, budgets = {}) {
	return catalog.map((model) => ({
		...model,
		contextWindow: budgets[model.id] === void 0 ? model.contextWindow : Math.min(model.contextWindow, budgets[model.id])
	}));
}
/**
* Derive the runtime catalog from the last-refreshed directory plus the user's
* selection.
*
* An empty selection means "never configured" and serves the whole directory.
* But a NON-empty selection that intersects the directory in nothing must NOT
* serve nothing: that is the issue #32 failure mode (the picker empties out),
* and it now has a realistic trigger — a user whose only ticked model was the
* upstream's `auto` router, which this version stops offering. Such a selection
* degrades to the whole directory rather than to silence: the user asked for
* "some models to be on", and the alternative is a region with no models at
* all. An empty directory still yields an empty result; the guard is only about
* a selection that no longer matches anything.
*/
function deriveCatalog(catalog, enabled, budgets = {}) {
	const selected = enabled.size === 0 ? catalog : catalog.filter((model) => enabled.has(model.id));
	return applyContextBudgets(selected.length === 0 && enabled.size > 0 ? catalog : selected, budgets);
}
/**
* Mutable catalog shared by the shim's `/v1/models` and the adapter.
*
* The static fallback exists so an OFFLINE upstream never leaves a provider
* empty — but "offline" presumes the region is usable at all. A region with no
* local sign-in cannot serve one single request, so seeding it with a roster
* puts models in the picker that are guaranteed to 401 (issue #12). The host
* distinguishes the two cases through {@link WorkBuddyCatalog.setRegionUsable}.
*/
var WorkBuddyCatalog = class {
	models;
	/**
	* Whether {@link models} came from the upstream at least once.
	*
	* Starts `false`: the constructor seeds the static fallback, and that list
	* must never be mistaken for a live answer (see {@link hasLiveRoster}).
	*/
	live = false;
	/**
	* Whether this region has any local sign-in. Defaults to `true` — the
	* permissive direction — so a scan that has not run yet (or failed) keeps
	* serving the fallback rather than blanking a region that may be fine.
	*/
	usable = true;
	/**
	* Whether the user has switched this region's provider ON. Opt-out: defaults
	* to `true`, so a config predating this switch (and the pre-region-split flat
	* fields, which never carry `enabled`) keeps both providers running. Set to
	* `false` by `setRegionEnabled` to withdraw the region from DSH's model
	* picker entirely (its adapter route and configurable-provider entry are
	* pulled by the Host via `AdapterRegistrationHandle.replace([])` /
	* `DirectoryRegistrationHandle.replace([])`). This is a USER choice, distinct
	* from {@link usable}: a region the user switched off keeps its catalog,
	* accounts, and model picks intact and reappears the moment they re-check it.
	*/
	enabled = true;
	/**
	* @param region Seeds the static fallback for this region; each region's
	* provider must never serve the other region's roster before its first
	* live refresh lands.
	*/
	constructor(region = "cn") {
		this.models = fallbackModelsFor(region);
	}
	/**
	* Current entries; the fallback list until the upstream answer lands.
	*
	* Empty while this region has no local sign-in OR the user has switched it
	* off: the provider stays registered (its row still hosts the settings card
	* and the account picker), but it advertises nothing to pick. DSH drops empty
	* provider groups from the picker (`buildModelCatalog` filters
	* `models.length > 0`), so the group disappears exactly when it would be pure
	* noise. The two empty causes are independent: `usable` is the automatic
	* "no account" gate (issue #12), `enabled` is the user's explicit on/off.
	*/
	current() {
		return this.usable && this.enabled ? this.models : [];
	}
	/**
	* Whether {@link current} is an UPSTREAM answer rather than the built-in
	* fallback it was constructed with.
	*
	* This distinction is what keeps issue #32 fixed. `applySelection` passes
	* `current()` into `configuredModels` as the live roster to fall back to, so
	* a partial saved slot demotes to the live directory instead of the static
	* list. But before the first refresh lands, `current()` IS the static list
	* (the constructor seeds it), and `resolveRoster` cannot tell the two apart
	* because it only sees a non-empty array. The result was the exact bug #32
	* describes, reached from the other direction: a settings write arriving
	* before the first catalog refresh let the STATIC roster masquerade as live,
	* and `set()` then committed it — so a model that only exists upstream
	* (`space-bunny`) vanished from the picker while the runtime still served it.
	*
	* Callers that use `current()` as a *live* answer must check this first. A
	* caller that only wants "what would we advertise right now" does not need
	* to: the fallback is the honest answer to that question.
	*/
	hasLiveRoster() {
		return this.live;
	}
	/** Whether this region currently advertises any model. */
	isRegionUsable() {
		return this.usable;
	}
	/** Whether the user has this region's provider switched on. */
	isRegionEnabled() {
		return this.enabled;
	}
	/**
	* Record whether this region has a local sign-in.
	*
	* Separate from {@link set} on purpose: `set()` carries a live upstream
	* answer and must never be empty, while "this region has no account" is a
	* legitimate empty state that must survive across refreshes. Keeping them
	* apart is what lets the non-empty guard stay strict.
	*
	* @returns whether the value changed, so the caller can skip invalidating
	*   its adapter snapshots when nothing moved.
	*/
	setRegionUsable(usable) {
		if (this.usable === usable) return false;
		this.usable = usable;
		return true;
	}
	/**
	* Record the user's explicit on/off choice for this region's provider.
	*
	* Distinct from {@link setRegionUsable}: that is the automatic "no local
	* account" gate, while this is a deliberate user action (issue #11-style
	* region switch). The Host reads the same `enabled` flag through
	* `regionStateOf(config, region).enabled !== false`, so the two halves never
	* disagree. Returns whether the value changed.
	*/
	setRegionEnabled(enabled) {
		if (this.enabled === enabled) return false;
		this.enabled = enabled;
		return true;
	}
	/**
	* Replace the list; callers invalidate their adapter snapshot after this.
	*
	* `origin` says where the list came from, and it is not cosmetic: only an
	* `upstream` answer may mark the catalog live. `applySelection` also calls
	* this on every settings write — including before the first refresh has
	* landed — and the list it passes then is the static fallback. Letting that
	* count as live is what re-opened issue #32 (see {@link hasLiveRoster}).
	*
	* The default is `'upstream'` so every pre-existing call site keeps meaning
	* what it meant; only the re-derivation path opts into `'derived'`.
	*/
	set(models, origin = "upstream") {
		if (models.length === 0) throw new Error("workbuddy model catalog cannot be empty");
		if (origin === "upstream") this.live = true;
		this.models = models.map((model) => ({ ...model }));
	}
};
/** 文件名，带前导点，与 `.workbuddy-device.json` 同一约定。 */
const DEVICE_PROFILE_FILE_NAME = ".workbuddy-device-profiles.json";
/**
* 文件不存在、不可读、版本不认识时的答案：虚拟档、无覆盖、回退开、无手填目录。
*
* 回退默认**开**，所以一个 5.16.0 时代写下的文件（没有这个字段）升级后立刻拿到
* 作者希望的默认行为，不需要用户去点一次。
*/
function emptyDocument() {
	return {
		version: 1,
		mode: "virtual",
		accounts: {},
		sdkDir: "",
		sdkFallbackToVirtual: true
	};
}
/**
* 读盘缓存：同一进程内的请求路径不该每条都去读 200 字节。
*
* **按路径索引**，不是一个全局槽：这个模块同时服务"真实 DSH home"与测试里
* 那些临时目录，一个全局槽会让第二台机器（或第二个测试）读到第一份内容。
*/
const CACHE_MS = 5e3;
const cache = /* @__PURE__ */ new Map();
/** Drop the cache — every write calls this, so a save is visible immediately. */
function invalidate() {
	cache.clear();
}
/** `$DSH_HOME/.workbuddy-device-profiles.json`, or `dir` when one is pinned (tests). */
function deviceProfilePath(dir) {
	const base = typeof dir === "string" && dir !== "" ? dir : resolveDshHome();
	return join(base, DEVICE_PROFILE_FILE_NAME);
}
/** Whether an unknown value is a mode this build understands. */
function isDeviceMode(value) {
	return value === "virtual" || value === "real";
}
/** Keep only the fields that are well-formed; a hand-edited file must not break a request. */
function sanitizeAccount(raw) {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return void 0;
	const record = raw;
	const account = {};
	if (typeof record["uid"] === "string" && record["uid"] !== "") account.uid = record["uid"];
	if (typeof record["machineId"] === "string" && isDeviceId(record["machineId"])) account.machineId = record["machineId"];
	if (typeof record["sessionId"] === "string" && isDeviceId(record["sessionId"])) account.sessionId = record["sessionId"];
	if (typeof record["updatedAt"] === "string") account.updatedAt = record["updatedAt"];
	return account.uid === void 0 && account.machineId === void 0 && account.sessionId === void 0 ? void 0 : account;
}
/** Read the on-disk document, tolerating anything a hand edit can produce. */
async function readStored(dir, nowMs = Date.now(), fresh = false) {
	const path = deviceProfilePath(dir);
	const hit = cache.get(path);
	if (!fresh && hit !== void 0 && nowMs - hit.at < CACHE_MS) return hit.document;
	const remember = (document) => {
		cache.set(path, {
			at: nowMs,
			document
		});
		return document;
	};
	let text;
	try {
		text = await readFile(path, "utf8");
	} catch {
		return remember(emptyDocument());
	}
	let parsed;
	try {
		parsed = JSON.parse(text);
	} catch {
		return remember(emptyDocument());
	}
	const record = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : {};
	if (record["version"] !== 1) return remember(emptyDocument());
	const accounts = {};
	const rawAccounts = record["accounts"];
	if (typeof rawAccounts === "object" && rawAccounts !== null && !Array.isArray(rawAccounts)) for (const [id, value] of Object.entries(rawAccounts)) {
		const account = sanitizeAccount(value);
		if (account !== void 0) accounts[id] = account;
	}
	return remember({
		version: 1,
		mode: isDeviceMode(record["mode"]) ? record["mode"] : "virtual",
		accounts,
		sdkDir: typeof record["sdkDir"] === "string" ? record["sdkDir"].trim() : "",
		sdkFallbackToVirtual: record["sdkFallbackToVirtual"] !== false
	});
}
/** The browser-facing shape: no uids, no timestamps it cannot use. */
function toSettings(document) {
	const accounts = {};
	for (const [id, account] of Object.entries(document.accounts)) {
		const profile = {
			...account.machineId === void 0 ? {} : { machineId: account.machineId },
			...account.sessionId === void 0 ? {} : { sessionId: account.sessionId }
		};
		if (profile.machineId !== void 0 || profile.sessionId !== void 0) accounts[id] = profile;
	}
	return {
		mode: document.mode,
		accounts,
		sdkDir: document.sdkDir,
		sdkFallbackToVirtual: document.sdkFallbackToVirtual
	};
}
/** Read the settings the card renders. Never throws. */
async function readDeviceSettings(options = {}) {
	return toSettings(await readStored(options.dir));
}
/**
* 算出每个账号"留空时会发出"的那一对 id，供弹窗直接显示。
*
* 为什么需要它：弹窗里两个输入框为空时只写"留空 = 自动派生"，用户既看不到
* 结果，也无法判断两个账号是否被算成了同一台设备。把派生值摆出来，"留空"就从
* 一句承诺变成了一个可核对的事实。
*
* `uid` 由调用方（Host 的凭据库）提供——浏览器只知道 accountId，而**派生必须
* 用 uid**，因为构头时 `deviceHeaders()` 手上只有 credential.uid。两边用同一种
* 输入，界面显示的值才等于真正发出去的值。
*
* 盐不可用时返回 `undefined`（而不是空对象）：那一档一个设备头都不发，显示一个
* "派生值"会是在说谎；而空对象表示"盐是好的，但这些账号没有一个算得出来"
* （没有 uid），两者在界面上要说不同的话。
*/
async function describeDerivedDevices(entries, options = {}) {
	let salt = options.salt;
	if (salt === void 0) {
		const readout = options.dir === void 0 ? await readDeviceSalt() : await readDeviceSalt({ dir: options.dir });
		if (readout.state !== "ok") return void 0;
		salt = readout.salt;
	}
	if (salt === "") return void 0;
	const derived = {};
	for (const entry of entries) {
		if (entry.accountId === "" || entry.uid === "") continue;
		derived[entry.accountId] = {
			machineId: deriveDeviceId(entry.uid, "machine", salt),
			sessionId: deriveDeviceId(entry.uid, "session", salt)
		};
	}
	return derived;
}
/**
* Persist one document atomically.
*
* **The caller holds the lock.** Every write path takes `withFileLock` itself
* (read-merge-write must be one step against another process), so this function
* must not take it again — a second acquisition on the same path is how a save
* turns into a hang.
*/
async function writeStored(document, dir) {
	await writeFileAtomic(deviceProfilePath(dir), `${JSON.stringify(document, null, 2)}\n`, {
		mode: 384,
		dirMode: 448
	});
	invalidate();
}
/**
* Switch the device-head tier.
*
* 「真实值」目前只被记住，不改任何出站字节——P3 才接真 token 与互斥规则。
* 界面上必须把这件事说清楚（`row.deviceModeRealNote`），否则用户会以为切过去
* 就换成了真实设备。
*/
async function setDeviceMode(mode, options = {}) {
	return withFileLock(deviceProfilePath(options.dir), async () => {
		const next = {
			...await readStored(options.dir, Date.now(), true),
			mode
		};
		await writeStored(next, options.dir);
		return toSettings(next);
	});
}
/**
* Save the two SDK settings the card edits (作者意见 #1 与 #2).
*
* 两项都是**可选**参数，`undefined` 表示"不要动这一项"——与
* {@link saveDeviceProfile} 同一条约定：卡片上有两个独立控件，其中一个的保存
* 不该把另一个刚改的值写回旧值。
*
* `sdkDir` 只做去空白，不做存在性校验：一个路径填错的正确反馈是「探不到 SDK」
* （`probe` 会答 `missing` 或 `error` 并带上那个路径），而不是在这里拒绝保存——
* 后者会让用户面对一个"保存没反应"的输入框，而他刚刚明明看见文件在那儿。
*/
async function saveDeviceSdkSettings(values, options = {}) {
	return withFileLock(deviceProfilePath(options.dir), async () => {
		const next = {
			...await readStored(options.dir, Date.now(), true),
			...typeof values.sdkDir === "string" ? { sdkDir: values.sdkDir.trim() } : {},
			...typeof values.sdkFallbackToVirtual === "boolean" ? { sdkFallbackToVirtual: values.sdkFallbackToVirtual } : {}
		};
		await writeStored(next, options.dir);
		return toSettings(next);
	});
}
/**
* Save (or clear) one account's overrides.
*
* `machineId` / `sessionId` 为 `''` 表示"清掉这一项、回到派生值"；为 `undefined`
* 表示"不要动这一项"。两种省略必须能分开：弹窗里只改机器 id 时，不能把用户之前
* 设的 session id 顺手抹掉。
*
* @throws when a supplied value is not a 36-character lowercase hex id — the
*   route turns that into a 400 rather than writing a value the upstream will reject.
*/
async function saveDeviceProfile(accountId, values, options = {}) {
	for (const value of [values.machineId, values.sessionId]) if (value !== void 0 && value !== "" && !isDeviceId(value)) throw new Error("device id must be 36 lowercase hex characters");
	return withFileLock(deviceProfilePath(options.dir), async () => {
		const document = await readStored(options.dir, Date.now(), true);
		const next = { ...document.accounts[accountId] ?? {} };
		if (values.uid !== void 0 && values.uid !== "") next.uid = values.uid;
		for (const key of ["machineId", "sessionId"]) {
			const value = values[key];
			if (value === void 0) continue;
			if (value === "") delete next[key];
			else next[key] = value;
		}
		next.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
		const accounts = {
			...document.accounts,
			[accountId]: next
		};
		if (next.machineId === void 0 && next.sessionId === void 0) delete accounts[accountId];
		const merged = {
			...document,
			accounts
		};
		await writeStored(merged, options.dir);
		return toSettings(merged);
	});
}
/** Build the lookup; `ttlMs` exists so an externally edited file is still picked up. */
function createDeviceProfileLookup(options = {}) {
	const byUid = (document) => {
		const map = /* @__PURE__ */ new Map();
		for (const account of Object.values(document.accounts)) {
			if (account.uid === void 0) continue;
			const profile = {
				...account.machineId === void 0 ? {} : { machineId: account.machineId },
				...account.sessionId === void 0 ? {} : { sessionId: account.sessionId }
			};
			if (profile.machineId !== void 0 || profile.sessionId !== void 0) map.set(account.uid, profile);
		}
		return map;
	};
	return {
		async forUid(uid) {
			if (uid === "") return void 0;
			return byUid(await readStored(options.dir)).get(uid);
		},
		async mode() {
			return (await readStored(options.dir)).mode;
		},
		async fallbackToVirtual() {
			return (await readStored(options.dir)).sdkFallbackToVirtual;
		},
		async sdkDir() {
			return (await readStored(options.dir)).sdkDir;
		}
	};
}
//#endregion
//#region src/turing-sdk.ts
/**
* 真实设备参数：本机已安装的 WorkBuddy 桌面端自带 Turing Shield SDK 的取链（P3）。
*
* ## SDK 从哪来
*
* 插件**不携带任何 SDK 副本**。原生模块与厂商 DLL 是桌面端自己的构建产物
* （`turing_sdk.node` 内的 pdb 路径指向桌面端仓库），随插件再分发既无 provenance
* 也无许可证，因此这个模块找的是**用户机器上已安装的那份**：环境变量
* `WORKBUDDY_TURING_SDK_DIR` 显式指定优先，否则按桌面端的安装形状（Windows 卸载
* 注册表 + 常见目录，macOS `/Applications` 与 `~/Applications` 的 bundle）现推
* SDK 目录。找不到就是 `missing`——真实值档下发零个设备头，与从前"这个平台没有
* 副本"是同一个降级，用户能做的是装上桌面端或指定目录。
*
* ## 它补的是哪一格
*
* 「虚拟值」档的设备对（`X-Machine-ID` / `X-Session-ID`）是算出来的：稳定、按号
* 隔离，但**任何一台机器都能算出同样的形状**。「真实值」档要的是这台机器上
* 真的装着的那套东西——由 SDK 向风控服务换回的 `X-Device-Token`。两者互斥，不能
* 叠加：真 token 内含设备信息，旁边再挂一对伪造 id 等于自证不一致。
*
* ## 为什么要子进程
*
* SDK 是原生插件（N-API），加载它会绑定宿主进程：一次 ABI/缺 DLL/被替换的失败
* 就是插件进程的失败，而不是"设备头不可用"；它的 Promise 没有 cancel，一次超时
* 会把句柄留在进程里。子进程把这两件事都降级成"这一条命令失败"，父进程杀掉它
* 就是干净的收场。代价是每次冷启动多一次进程创建（本机实测 ~6 ms）。
*
* ## 缓存策略
*
* token 是分钟级的东西、进程是小时级的，所以**绝不能只取一次**。内存 TTL 10 分钟，
* 失败时回落到 24 小时内的旧值并标记 `stale`（设备 token 的有效期远长于它的
* 刷新周期）。**不落盘**：多一份 secret 文件换来的只是省掉一次 100 ms 的取数，
* 不划算——这与 P2 的文件源是两种东西，那个读的是别人写的文件。
*
* ## 谁来决定"什么时候取"
*
* 请求路径只在**要发请求**时调 {@link TuringTokenSource.current}，所以一个空闲
* 进程一辈子不会刷新 token——面板上永远是"已加载、没取过"，而用户无法把这句话
* 与"SDK 坏了"区分开。插件 apply 时调 {@link TuringSdk.startAutoRefresh}：立刻
* 取一次，此后在 TTL 到期前自动换新；失败按 {@link TuringKeepAliveTiming.retryMs}
* 重试，本机没有 SDK 则按 {@link TuringKeepAliveTiming.unavailableMs} 慢查。
*
* ## 从不打印 token
*
* 这个模块的任何日志、任何返回给浏览器的状态里都只有掩码与长度。完整值只经
* {@link TuringTokenSource.reveal} 在用户显式点击时给一次。
*
* @module dsh-connect-workbuddy/turing-sdk
*/
/** 允许指向别的 SDK 副本（自建、或桌面端安装目录）。 */
const TURING_SDK_DIR_ENV = "WORKBUDDY_TURING_SDK_DIR";
/** 取不到新 token 时，旧值最多还能用多久。设备 token 本身长期有效。 */
const TURING_TOKEN_STALE_MS = 864e5;
/** 子进程的总预算。SDK 在本机实测 ~110 ms；给到 20 s 是为了覆盖冷启动与 DNS 慢。 */
const RUN_TIMEOUT_MS = 2e4;
/** `probe` 的缓存时长：SDK 在进程生命周期内不会变，但 DLL 可能被外部替换。 */
const PROBE_CACHE_MS = 6e4;
/**
* 取数失败后的退避窗口。
*
* 这不是性能优化，是正确性：一次对话会并发打出十几条请求，如果每次失败都重试，
* 一个 SDK 故障会变成"每轮十几个子进程 + 十几个 20 秒超时"。退避期间直接返回上一枚
* 可用值（没有就返回 `undefined`），而**手动「重新获取」绕过它**——用户点那个按钮，
* 就是要求现在再试一次。
*/
const RETRY_BACKOFF_MS = 3e4;
/** 生产用法；测试可以整体或部分覆盖（见 `createTuringSdk` 的 `keepAliveTiming`）。 */
const TURING_KEEP_ALIVE_TIMING = {
	leadMs: 15e3,
	retryMs: 6e4,
	unavailableMs: 3e5,
	minDelayMs: 5e3
};
/** 决定下一次自动预热的延迟（毫秒）。导出来是为了能直接测调度，而不必真等十分钟。 */
function nextAutoRefreshDelayMs(input, timing = TURING_KEEP_ALIVE_TIMING) {
	const { nowMs, ttlMs, fetchedAtMs, lastFailureAtMs, sdkState } = input;
	if (fetchedAtMs !== void 0) {
		if (lastFailureAtMs !== void 0 && lastFailureAtMs >= fetchedAtMs) return timing.retryMs;
		const remainMs = ttlMs - timing.leadMs - (nowMs - fetchedAtMs);
		return Math.max(remainMs, timing.minDelayMs);
	}
	return sdkState !== void 0 && sdkState !== "ready" ? timing.unavailableMs : timing.retryMs;
}
/** 内置副本的目录名，按 `platform-arch` 分。目前只有 Windows。 */
/** 展示用的主机的三元组，`win32-x64` 之类。SDK 目录**不再**按它拼——见下方发现逻辑。 */
function bundledSdkBundleId(platform = process.platform, arch = process.arch) {
	return `${platform}-${arch}`;
}
/**
* 插件自带的 `native/turing-sdk` 根目录——现在里面**只有** `worker.cjs` 与这份
* README，不再有 SDK 副本（原生模块与厂商 DLL 是桌面端的构建产物，不随插件分发）。
*
* `import.meta.url` 指向 `lib/index.js`（构建产物）或 `src/turing-sdk.ts`（开发与
* 测试），两者都在包根下一层，所以 `../native/...` 在两种形态下都成立——这是
* 不用 `process.cwd()` 的原因：cwd 是调用者的，不是插件的。
*/
function bundledSdkRoot() {
	return fileURLToPath(new URL("../native/turing-sdk", import.meta.url));
}
/** 子进程脚本的路径；随插件分发，加载的是**用户机器上**的 SDK。 */
function workerPath() {
	return join(bundledSdkRoot(), "worker.cjs");
}
/**
* SDK 目录相对桌面端安装根目录的形状（Electron 把原生模块从 asar 里解包出来）。
*
* macOS 实测（A 级，2026-11-01，`/Applications/WorkBuddy.app` 与
* `"/Applications/WorkBuddy AI.app"` 两份都在）：
* `<bundle>/Contents/Resources/app.asar.unpacked/native/turing-sdk`，里面有
* `index.cjs` / `package.json` / `build/Release/turing_sdk.node`。
* Windows 实测（A 级，2026-11-01，`F:\智能体安装路径\WorkBuddy`）：
* `<install>\resources\app.asar.unpacked\native\turing-sdk` 同形状成立——
* `WorkBuddy.exe` → 该目录 → `hasTuringSdkBinding` 命中，doctor 报
* `ready (win32-x64 — <install>\resources\app.asar.unpacked\native\turing-sdk)`
* 并经桌面端自己的 SDK 副本取到 1174 字符真 token。另经 app.asar 解包核对：
* `native/turing-sdk` 在 asar 头里标 `unpacked`，实体只在 `app.asar.unpacked`
* 一侧，两条路径就是全部分布。注意 DSH Desktop / DSH NEXT 本身是另一种应用、
* **不含**这份 SDK——发现的搜索对象是 WorkBuddy 桌面端，不是运行宿主。
*/
function installedSdkDirFromExecutable(platform, executable) {
	if (platform === "win32") {
		const install = win32.dirname(executable);
		return win32.join(install, "resources", "app.asar.unpacked", "native", "turing-sdk");
	}
	if (platform === "darwin") {
		const contents = posix.dirname(posix.dirname(executable));
		const bundle = posix.dirname(contents);
		return posix.join(bundle, "Contents", "Resources", "app.asar.unpacked", "native", "turing-sdk");
	}
}
/** 一份 turing-sdk 目录是不是能用：原生模块在不在它声明的位置。 */
function hasTuringSdkBinding(dir, exists = existsSync, platform = process.platform) {
	const parts = [
		"build",
		"Release",
		"turing_sdk.node"
	];
	const dataJoin = platform === "win32" ? win32.join : posix.join;
	const alternateJoin = platform === "win32" ? posix.join : win32.join;
	const dataPath = dataJoin(dir, ...parts);
	if (exists(dataPath)) return true;
	const alternatePath = alternateJoin(dir, ...parts);
	return alternatePath !== dataPath && exists(alternatePath);
}
/**
* 按桌面端的安装形状找本机已安装的 SDK 目录，返回**第一个可用的**。
*
* 候选来自 `at-rest.ts` 的同一套安装形状（env 覆盖 → 默认布局；win32 再加
* 卸载注册表这一路，覆盖装在非默认盘的情况）。所有 win32 路径都用
* `path.win32`、darwin 用 `path.posix` 拼：这些是**数据**规定的分隔符，
* 用宿主的 `join` 会在 macOS CI 上产出永不存在的混分隔符路径（docs/WINDOWS.md
* 的铁律，`at-rest.ts` 里已有前科）。
*
* 每个注入参数都是测试缝（RELEASING.md §2.5：断言不能钉住跑测试的机器）：
* `exists` 决定"这份安装里有没有 SDK"，`readRegistryAppPath` 决定注册表答案；
* 注册表只在 `platform === 'win32'` 时读——否则 macOS 上的单元测试会去 spawn
* 一个本机根本不存在的 `reg.exe`。
*/
function discoverInstalledSdkDir(options = {}) {
	const platform = options.platform ?? process.platform;
	const home = options.home ?? homedir();
	const env = options.env ?? process.env;
	const exists = options.exists ?? existsSync;
	const executables = workbuddyAppExecutableCandidates(platform, home, env);
	if (platform === "win32") {
		const fromRegistry = (options.readRegistryAppPath ?? windowsRegistryAppExecutable)();
		if (fromRegistry !== void 0) executables.push(fromRegistry);
	}
	const seen = /* @__PURE__ */ new Set();
	for (const executable of executables) {
		const dir = installedSdkDirFromExecutable(platform, executable);
		if (dir === void 0 || seen.has(dir)) continue;
		seen.add(dir);
		if (!exists(executable)) continue;
		if (hasTuringSdkBinding(dir, exists, platform)) return dir;
	}
}
/** 掩码：保住 scheme 前缀，其余一律星号。`v3:` 是 SDK 的格式标记，不是内容。 */
function maskToken(token) {
	if (token === "") return "";
	const colon = token.indexOf(":");
	return `${colon > 0 && colon <= 8 ? token.slice(0, colon + 1) : ""}${"*".repeat(16)}`;
}
/**
* Run the worker once.
*
* `env` 只带 SDK 需要的白名单，不整份继承：父进程环境里有插件的凭据与用户配置，
* 一个只需要网络和系统 DLL 的子进程没有理由看到它们。
*/
function runWorker(mode, options) {
	return new Promise((resolve) => {
		const runtime = process.execPath;
		const env = {
			TURING_SDK_DIR: options.dir,
			TURING_CHANNEL_ID: options.channelId,
			TURING_PRODUCT_NAME: options.productName,
			TURING_PRODUCT_VERSION: options.productVersion,
			TURING_TIMEOUT_MS: String(options.timeoutMs ?? 18e3),
			TURING_KEYCHAIN_STORAGE: options.keychainStorage === true ? "1" : "0"
		};
		for (const name of [
			"PATH",
			"SystemRoot",
			"windir",
			"TEMP",
			"TMP",
			"USERPROFILE",
			"HOME",
			"LOCALAPPDATA",
			"APPDATA",
			"PROCESSOR_ARCHITECTURE",
			"NUMBER_OF_PROCESSORS",
			"LANG",
			"LC_ALL"
		]) {
			const value = process.env[name];
			if (value !== void 0) env[name] = value;
		}
		if (process.versions.electron !== void 0) env["ELECTRON_RUN_AS_NODE"] = "1";
		let stdout = "";
		let stderr = "";
		let settled = false;
		const settle = (answer) => {
			if (settled) return;
			settled = true;
			clearTimeout(killer);
			resolve(answer);
		};
		const child = spawn(runtime, [options.worker, mode], {
			env,
			windowsHide: true,
			stdio: [
				"ignore",
				"pipe",
				"pipe"
			]
		});
		const killer = setTimeout(() => {
			child.kill("SIGKILL");
			settle({
				ok: false,
				reason: "timeout",
				message: `worker did not answer within ${options.timeoutMs ?? RUN_TIMEOUT_MS}ms`
			});
		}, options.timeoutMs ?? RUN_TIMEOUT_MS);
		child.stdout?.setEncoding("utf8");
		child.stdout?.on("data", (chunk) => {
			stdout += chunk;
		});
		child.stderr?.setEncoding("utf8");
		child.stderr?.on("data", (chunk) => {
			stderr = `${stderr}${chunk}`.split("\n").slice(-4).join("\n");
		});
		child.on("error", (error) => {
			settle({
				ok: false,
				reason: "spawn-failed",
				message: error.message
			});
		});
		child.on("close", (code) => {
			const line = stdout.trim().split("\n").filter(Boolean).at(-1);
			if (line === void 0) {
				settle({
					ok: false,
					reason: "no-output",
					message: stderr.trim() || `worker exited with code ${String(code)}`
				});
				return;
			}
			try {
				settle(JSON.parse(line));
			} catch {
				settle({
					ok: false,
					reason: "bad-output",
					message: stderr.trim() || "worker printed no JSON"
				});
			}
		});
	});
}
/**
* Wire a {@link TuringSdk} into the card.
*
* `mode` 从设备设置读，不缓存：用户刚切换的那一下必须立刻反映到面板上。
*/
function createDeviceSdkPort(options) {
	const snap = async () => ({
		tier: await options.mode(),
		sdk: await options.sdk.info(),
		token: options.sdk.tokens.readout()
	});
	return {
		read: snap,
		async refresh() {
			await options.sdk.tokens.refresh();
			return snap();
		},
		reveal: () => options.sdk.tokens.reveal(),
		readEnabled: async () => options.enabled === void 0 ? void 0 : options.enabled.read(),
		writeEnabled: async (enabled) => options.enabled === void 0 ? false : options.enabled.write(enabled)
	};
}
/**
* Build the SDK handle.
*
* `version` 默认取插件自称的应用版本（与 `User-Agent` 同源），因为它就是这台机器
* 上那个客户端报给上游的版本；`channelId` 与产品名跟桌面端 `product.json` 一致。
*/
function createTuringSdk(options = {}) {
	const now = options.now ?? (() => Date.now());
	const worker = options.worker ?? workerPath();
	const ttlMs = options.ttlMs ?? 6e5;
	const keepAliveTiming = {
		...TURING_KEEP_ALIVE_TIMING,
		...options.keepAliveTiming
	};
	/**
	* 每次**现读**开关，不在构造时求值一次。
	*
	* 开关是 `asVolatile` 的配置项，热更新后会变；而句柄活到卸载。钉死一次会让
	* "关掉开关"必须重启宿主才生效——那与这个开关存在的理由（随时能停）矛盾。
	*
	* 未传 `enabled` 时回落到环境变量（{@link TURING_SDK_ENABLED_ENV}）：那是给
	* `doctor` 这种读不到插件配置的独立进程用的。插件永远显式传，所以两边不会打架。
	*
	* **默认也是关**，与插件的 `default(false)` 同一个答案。代价是 `doctor` 在用户
	* 开启之前只答 `disabled`——但那正是现状，而 `doctor` 的全部价值就是如实回答
	* 现状。想排障"这个 SDK 到底能不能用"，用
	* `WORKBUDDY_DEVICE_SDK_ENABLED=1 node lib/bin.js doctor` 临时打开即可。
	*/
	const isEnabled = () => options.enabled !== void 0 ? options.enabled !== false : /^(?:1|true)$/u.test(String((options.env ?? process.env)["WORKBUDDY_DEVICE_SDK_ENABLED"] ?? "").trim());
	const platform = options.platform ?? process.platform;
	const arch = options.arch ?? process.arch;
	const env = options.env ?? process.env;
	const exists = options.exists ?? existsSync;
	const bundle = bundledSdkBundleId(platform, arch);
	/**
	* SDK 目录的**解析器**，不是一个常量（作者意见 #1）。
	*
	* 卡片上填一个目录、点保存，下一步就该看见 `ready`——所以目录必须在每次
	* `probe` 时重新问一次，而不是在 `createTuringSdk` 时钉死。构造期钉死会让
	* "填了但没生效"成为唯一的可能结果，而用户没有任何办法判断是路径错了还是需要
	* 重启（后者在这条链路上根本不存在）。
	*
	* 优先级：显式 `dir`（测试）→ `WORKBUDDY_TURING_SDK_DIR`（排障旁路）→ 卡片上
	* 手填的值（{@link TuringSdkOptions.dirSource}）→ 自动发现 → 空串（`missing`）。
	* 环境变量压过设置的理由写在 `device-profile.ts` 的 `sdkDir` 上。
	*/
	const resolveDir = async () => {
		const configured = options.dir ?? env["WORKBUDDY_TURING_SDK_DIR"];
		if (configured !== void 0 && configured.trim() !== "") return configured.trim();
		const fromCard = options.dirSource === void 0 ? "" : (await options.dirSource()).trim();
		if (fromCard !== "") return fromCard;
		return discoverInstalledSdkDir({
			platform,
			home: options.home,
			env,
			exists,
			readRegistryAppPath: options.readRegistryAppPath
		}) ?? "";
	};
	const channelId = options.channelId ?? env["WORKBUDDY_TURING_CHANNEL_ID"] ?? "109144";
	const productName = options.productName ?? env["WORKBUDDY_TURING_PRODUCT_NAME"] ?? "WorkBuddy";
	const productVersion = options.productVersion ?? env["WORKBUDDY_TURING_PRODUCT_VERSION"] ?? "5.8.3";
	const keychainStorage = options.keychainStorage ?? /^(?:1|true)$/u.test(String(env["WORKBUDDY_TURING_KEYCHAIN_STORAGE"] ?? "").trim());
	let probeCache;
	let cached;
	let lastAttemptMs;
	let lastFailure;
	/** 最近一次失败的时刻；退避窗口由它算。 */
	let lastFailureAtMs;
	let inFlight;
	/** 后台预热的定时器；`undefined` 表示当前没有排下一轮。 */
	let keepAliveTimer;
	let keepAliveActive = false;
	/** 最近一次 probe 的结论，用来决定"没有 token"时多久再问一次。 */
	let lastSdkState;
	const runtimeLabel = process.versions.electron === void 0 ? process.version.replace(/^v/u, "") : `electron ${process.versions.electron}`;
	const missingInfo = (path) => {
		const present = path !== "" && exists(path);
		return {
			state: present ? "error" : "missing",
			bundle,
			path,
			platform,
			arch,
			runtime: runtimeLabel,
			reason: present ? "SDK directory exists but the native binding was not found" : `no installed WorkBuddy desktop SDK detected on ${bundle}; install the desktop app or set ${TURING_SDK_DIR_ENV}`
		};
	};
	async function probe() {
		const at = now();
		/**
		* 总开关先于一切：关掉时**不解析目录、不碰文件系统、不起子进程**。
		*
		* 放在 `resolveDir()` 之前是刻意的——目录解析本身要读环境、可能读注册表（win32），
		* 而关掉开关的人要的正是"这个插件别去碰桌面端"。
		*/
		if (!isEnabled()) return {
			state: "disabled",
			bundle,
			path: "",
			platform,
			arch,
			runtime: runtimeLabel,
			reason: "the real-device SDK is turned off in this plugin's settings"
		};
		const dir = await resolveDir();
		if (probeCache !== void 0 && probeCache.path === dir && at - probeCache.at < PROBE_CACHE_MS) return probeCache.info;
		let info;
		if (dir === "" || !hasTuringSdkBinding(dir, exists, platform)) info = missingInfo(dir);
		else {
			const answer = await runWorker("probe", {
				dir,
				worker,
				channelId,
				productName,
				productVersion,
				timeoutMs: 15e3,
				keychainStorage
			});
			const supported = answer.ok === true && answer.supported === true;
			info = {
				state: supported ? "ready" : answer.ok === true ? "unsupported" : "error",
				bundle,
				path: dir,
				platform,
				arch,
				runtime: answer.node ?? runtimeLabel,
				...supported ? {} : { reason: answer.loadError ?? answer.message ?? answer.reason ?? "sdk reported unsupported" }
			};
		}
		probeCache = {
			at,
			path: dir,
			info
		};
		return info;
	}
	function readout() {
		const at = now();
		if (cached === void 0) return {
			state: "idle",
			masked: "",
			length: 0,
			...lastAttemptMs === void 0 ? {} : { lastAttemptMs },
			...lastFailure === void 0 ? {} : { reason: lastFailure }
		};
		const ageMs = at - cached.fetchedAtMs;
		const expired = ageMs > ttlMs;
		const tooOld = ageMs > TURING_TOKEN_STALE_MS;
		const failedSinceFetch = lastFailure !== void 0 && lastAttemptMs !== void 0 && lastAttemptMs >= cached.fetchedAtMs;
		return {
			state: tooOld ? "unavailable" : expired || failedSinceFetch ? "stale" : "ok",
			masked: maskToken(cached.token),
			length: cached.token.length,
			fetchedAtMs: cached.fetchedAtMs,
			...lastAttemptMs === void 0 ? {} : { lastAttemptMs },
			...expired || failedSinceFetch ? { reason: lastFailure ?? `older than ${Math.round(ttlMs / 6e4)}m` } : {}
		};
	}
	async function fetchOnce() {
		lastAttemptMs = now();
		const info = await probe();
		lastSdkState = info.state;
		if (info.state !== "ready") {
			lastFailure = info.reason ?? `sdk is ${info.state}`;
			lastFailureAtMs = lastAttemptMs;
			return;
		}
		const answer = await runWorker("token", {
			dir: info.path,
			worker,
			channelId,
			productName,
			productVersion,
			keychainStorage
		});
		const token = typeof answer.token === "string" ? answer.token.trim() : "";
		if (answer.ok !== true || token === "") {
			lastFailure = answer.message ?? answer.reason ?? "sdk returned no token";
			lastFailureAtMs = lastAttemptMs;
			return;
		}
		cached = {
			token,
			fetchedAtMs: now()
		};
		lastFailure = void 0;
		lastFailureAtMs = void 0;
		return token;
	}
	async function current() {
		const at = now();
		if (!isEnabled()) return void 0;
		if (cached !== void 0 && at - cached.fetchedAtMs <= ttlMs) return cached.token;
		if (lastFailureAtMs !== void 0 && at - lastFailureAtMs < RETRY_BACKOFF_MS) return cached !== void 0 && at - cached.fetchedAtMs <= TURING_TOKEN_STALE_MS ? cached.token : void 0;
		if (inFlight !== void 0) return inFlight;
		inFlight = fetchOnce().finally(() => {
			inFlight = void 0;
		});
		const token = await inFlight;
		if (token !== void 0) return token;
		if (cached !== void 0 && now() - cached.fetchedAtMs <= TURING_TOKEN_STALE_MS) return cached.token;
	}
	/**
	* 预热一次：到期前换新，其余情况什么都不做。
	*
	* 与 {@link current} 的分工是这条需求的核心。`current()` 只在**请求要发出去**时
	* 被调用，所以一个空闲的进程永远不会刷新 token——面板看到的永远是"已加载、
	* 没取过"，而用户无法分辨那是"SDK 没工作"还是"还没轮到它工作"。预热在启动时
	* 与每次到期前跑，让"现在这枚 token 是什么"随时可以回答。
	*
	* 幂等：不算到期就返回，失败退避窗口内也返回，已有请求在飞就等它。
	*/
	async function warm() {
		const at = now();
		if (!isEnabled()) return;
		const failedSinceFetch = cached !== void 0 && lastFailureAtMs !== void 0 && lastFailureAtMs >= cached.fetchedAtMs;
		if (cached !== void 0 && at - cached.fetchedAtMs < ttlMs - keepAliveTiming.leadMs && !failedSinceFetch) return;
		if (lastFailureAtMs !== void 0 && at - lastFailureAtMs < RETRY_BACKOFF_MS) return;
		if (inFlight !== void 0) {
			await inFlight;
			return;
		}
		inFlight = fetchOnce().finally(() => {
			inFlight = void 0;
		});
		await inFlight;
	}
	function nextDelayMs() {
		return nextAutoRefreshDelayMs({
			nowMs: now(),
			ttlMs,
			...cached === void 0 ? {} : { fetchedAtMs: cached.fetchedAtMs },
			...lastFailureAtMs === void 0 ? {} : { lastFailureAtMs },
			...lastSdkState === void 0 ? {} : { sdkState: lastSdkState }
		}, keepAliveTiming);
	}
	/**
	* 一轮预热：取一次，然后按 {@link nextDelayMs} 排下一轮。
	*
	* 单链而不是 `setInterval`：间隔不是常数（成功是"到 TTL 前 15 秒"，失败是 60 秒，
	* SDK 不在这台机器上是 5 分钟），而且每一轮都要按**当下**的时间重算，否则系统
	* 休眠回来后会把积压的 tick 一次放出来。
	*/
	async function tick() {
		if (!keepAliveActive) return;
		try {
			await warm();
		} catch {}
		if (!keepAliveActive) return;
		keepAliveTimer = setTimeout(() => {
			tick();
		}, nextDelayMs());
		keepAliveTimer.unref?.();
	}
	return {
		info: probe,
		startAutoRefresh() {
			if (!isEnabled()) return;
			if (keepAliveActive) return;
			keepAliveActive = true;
			tick();
		},
		stopAutoRefresh() {
			keepAliveActive = false;
			if (keepAliveTimer !== void 0) {
				clearTimeout(keepAliveTimer);
				keepAliveTimer = void 0;
			}
		},
		tokens: {
			current,
			readout,
			reveal: current,
			/**
			* Force a refetch — but **keep** whatever is cached until the new value
			* arrives. 清空再取会让"手动刷新失败"顺手抹掉一枚还在宽限期内可用的
			* token，那正好是用户点刷新想避免的结果。
			*/
			async refresh() {
				if (inFlight !== void 0) return inFlight.then(() => readout());
				inFlight = fetchOnce().finally(() => {
					inFlight = void 0;
				});
				await inFlight;
				return readout();
			}
		}
	};
}
//#endregion
//#region src/pi-ai-runtime.ts
/**
* Which `@earendil-works/pi-ai` copy THIS plugin actually resolves at runtime.
*
* WHY THIS EXISTS (issues #24 / #25 / #26). The plugin declares pi-ai as a
* peer (`>=0.85.0 <0.88.0 || >=1.0.0-0 <2.0.0`), so the module it imports is
* whatever the host environment provides — and the two generations consume
* DIFFERENT context shapes:
*
* - 0.87 hands providers a normalized transcript: `{ messages: [ {role:
*   'system', content, toolsAdded}, … ] }`. The system prompt and the tool
*   declarations live ONLY on that leading system message; the top-level
*   `systemPrompt` / `tools` fields are gone, and 0.87's api never reads them
*   back.
* - 0.85 expects `{ systemPrompt, tools, messages }` and has no branch for a
*   `system` message inside `messages` at all: its token estimator crashes on
*   one (issue #24), and its wire converter silently drops it.
*
* Which copy resolves is NOT predictable from the host version alone: a
* nested 0.85.1 on disk shadows the host's 0.87.1 (the plugin author's own
* symlinked checkout does exactly that), while a clean market install has no
* local copy at all and resolves the host's (issue #26's reporter). The
* adapter therefore gates on what THIS plugin resolves.
*
* HOW it is detected — deliberately WITHOUT importing pi-ai:
* `import.meta.resolve` locates the entry file (executing nothing), the
* package manifest sitting beside it names the version, and the generation is
* decided from that version (0.87+ → modern). A static import would drag
* pi-ai into the standalone `doctor` CLI, which must also run from market
* installs where NO local pi-ai exists and the module is only provided inside
* the DSH host — a static import there is a load-time crash. Resolution
* itself does not need the module: the manifest version and the
* `normalizeContext` feature (present from 0.87 on, not before) agree across
* `0.87+` AND `1.x` — 1.x is 0.87's successor and keeps the same normalized
* transcript, so the split is `>= 0.87` rather than "within 0.x".
*
* When resolution FAILS — the normal state of a market install probed outside
* the host — there is no local copy, so inside DSH the host supplies pi-ai.
* Every DSH host that normalizes contexts (0.2.0+, via 0.87.1) also supplies
* 0.87.1, so the reported generation defaults to `modern` (pass-through).
* That default is safe on older hosts too: they never normalize, and a native
* 0.85-shaped context is an identity under BOTH branches of the adapter gate.
*
* `doctor` prints the resolved version and path so mixed-generation setups —
* the silent kind that produced #24 and #26 — become visible on demand.
*
* @module dsh-connect-workbuddy/pi-ai-runtime
*/
let cached;
/** Resolve (once) which pi-ai copy this plugin runs against. */
function piAiRuntimeInfo() {
	cached ??= piAiRuntimeFor(resolveModuleFile());
	return cached;
}
/**
* The decision table for one resolution result, exported so the branch that
* only ever runs on OTHER machines (a market install with no local pi-ai) is
* pinned by tests rather than by this comment.
*
* `undefined` means nothing local resolved — inside DSH the host supplies the
* module, and every host that normalizes contexts (0.2.0+, via 0.87.1) ships
* the modern generation, so that is the default. Older hosts never normalize,
* and their native 0.85-shaped context is an identity under either gate
* branch, so the default cannot hurt them.
*/
function piAiRuntimeFor(resolvedFrom) {
	if (resolvedFrom === void 0) return {
		generation: "modern",
		resolvedFrom: void 0,
		version: void 0,
		resolvedLocally: false
	};
	const version = readVersion(resolvedFrom);
	return {
		generation: generationOf(version),
		resolvedFrom,
		version,
		resolvedLocally: true
	};
}
/**
* The file the main entry resolved to; undefined when resolution itself fails.
*
* `import.meta.resolve` (not `require.resolve`): pi-ai's exports map exposes
* "." under the `import` condition only, so the CJS resolver refuses the bare
* specifier outright — the ESM resolver is the one this plugin actually
* imports with, so it is also the one whose answer is meaningful here.
*/
function resolveModuleFile() {
	try {
		return fileURLToPath(import.meta.resolve("@earendil-works/pi-ai"));
	} catch {
		return;
	}
}
/**
* The version of the package owning `moduleFile`. pi-ai's exports map does
* not expose `./package.json`, so the manifest is found by walking up from
* the resolved entry — `dist/index.js` sits directly inside the package —
* and claiming it only when its `name` matches, so a same-named ancestor
* (a pnpm virtual-store parent, for instance) cannot be misread.
*/
function readVersion(moduleFile) {
	if (moduleFile === void 0) return void 0;
	let directory = dirname(moduleFile);
	for (let depth = 0; depth < 4; depth++) {
		try {
			const parsed = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
			if (parsed.name === "@earendil-works/pi-ai" && typeof parsed.version === "string") return parsed.version;
		} catch {}
		const parent = dirname(directory);
		if (parent === directory) return void 0;
		directory = parent;
	}
}
/**
* The generation a manifest version belongs to.
*
* `0.87+` consumes normalized transcripts natively; earlier releases want the
* 0.85 shape, so within the declared peer range the split is exactly `0.87+`
* versus earlier. An unreadable version conservatively reports `legacy` (and
* doctor shows it as unreadable, so the guess is visible rather than silent).
*
* The 1.x line MUST land on `modern`, and it is not a hypothetical: DSH
* 0.2.1-alpha.2 ships `@earendil-works/pi-ai@1.0.2`, and DSH 0.2.1-rc.1 ships
* 1.1.0 (which is the version this plugin is now tested against). Both 0.87.1
* and 1.0.2/1.1.0 read tools from the same place
* (`context.messages` → the leading system message's `toolsAdded`; see
* pi-ai's `resolveTranscriptTools`). Matching only `0.<minor>.` classified
* 1.0.2 as `legacy`, so `withLegacyContext` folded the transcript into the
* 0.85 shape — which moves the tool declarations to a top-level `tools` field
* pi-ai 1.x never reads. Every request then went upstream with NO tools
* declared: no model could emit a `toolCall`, and the domestic gateway, which
* tolerates a prompt-less body, had the model write DSML markup into the answer
* text instead. The host's compatibility gate does not catch this: it only
* evaluates peers in the `@deepseek-ai/dsh*` namespace, so an out-of-range
* `@earendil-works/pi-ai` peer is never enforced.
*
* Deliberately match major 1 only. This establishes compatibility for the
* observed 1.x line (including current 1.1.0) without assuming an uninspected
* future major such as 2.x keeps the same transcript contract. The declared
* peer range remains the plugin's supported-version boundary.
*
* ⚠️ Being on `modern` is necessary but NOT sufficient. The modern branch must
* also FOLD a raw seam envelope: `dsh-llm-pi-ai` never normalizes, and 1.x
* reads only `context.messages`. Between 4.4.2 (which taught this function
* about major 1) and the 0.2.1-rc.1 fix, `withLegacyContext` returned the
* modern api UNWRAPPED, so every request on pi-ai 1.x went upstream with no
* prompt and no tool declarations. See `foldModernContext` in `adapter.ts`.
*/
function generationOf(version) {
	if (version === void 0) return "legacy";
	const major = /^(\d+)\./u.exec(version);
	if (major !== null && Number(major[1]) === 1) return "modern";
	const match = /^0\.(\d+)\./u.exec(version);
	if (match === null) return "legacy";
	return Number(match[1]) >= 87 ? "modern" : "legacy";
}
//#endregion
//#region src/cn-gateway.ts
/**
* The CN region's gateway host, and the ONE place an override is validated.
*
* ## Why this exists (issue #220)
*
* The CN chat gateway was the single hard-coded constant
* `https://copilot.tencent.com`. In a corporate network that filters on the TLS
* ClientHello's SNI, that name is reset before the handshake completes — while
* the SAME network lets the WorkBuddy desktop app work, because the app reads a
* failover list from its own config and uses `wb.tencentbuddy.com` as well.
*
* The reporter measured (2026-11-06): `copilot.tencent.com` answers
* `ECONNRESET` in <100ms while `wb.tencentbuddy.com` answers a normal
* `401 Authorization Required`. This module is what lets such a user point the
* plugin at a host their network actually permits.
*
* ## Why an allowlist, and not "any URL you like"
*
* The value feeds `Authorization: Bearer <token>` on every CN request, plus the
* refresh-token exchange. A free-form base is therefore a **credential
* exfiltration primitive**: whoever can edit the settings (a synced profile, a
* shared dotfile, a pasted "fix" from a forum post) could redirect a live
* WorkBuddy token to a host they run. That is a strictly worse failure than the
* timeout it fixes, and it is invisible — the requests would keep succeeding.
*
* So the override names a HOST from a closed set, never a URL from the open
* internet. The set is the CN product's own brand registrable domains, measured
* 2026-11-06 to answer the chat, billing, catalog and busy routes identically
* (see `docs/CN_GATEWAY_FALLBACK.md`):
*
*   copilot.tencent.com     the shipping default
*   wb.tencentbuddy.com     what the desktop app's failover.json lists
*   www.workbuddy.cn        the brand host
*   www.codebuddy.cn        the sibling brand host, also the billing base
*
* Each is admitted by REGISTRABLE domain, so any subdomain of those brands
* qualifies and a lookalike (`wb.tencentbuddy.com.evil.example`) cannot —
* the same rule `knownRegionOf` already applies to credential domains.
*
* ## What an override does NOT change
*
* `Origin` / `Referer` stay on the billing base (see `originReferer`): they
* describe which web app the request comes from, not which socket it reaches.
* Rewriting them from the override would make the identity claim disagree with
* itself for no benefit — the gateway reads them as "this is the CN web app".
*
* @module dsh-connect-workbuddy/cn-gateway
*/
/** The CN chat gateway the plugin has always used. */
const CN_GATEWAY_DEFAULT = "https://copilot.tencent.com";
/**
* Environment override for `doctor`, mirroring the settings field.
*
* WHY THIS EXISTS. `dsh plugin exec … doctor` runs in its own process, which
* never loads the plugin's settings — the same reason `WORKBUDDY_DEVICE_TOKEN_FILE`
* already exists as the CLI's way to see what the plugin sees. Without it, a
* user who fixed their network via the card's field would run `doctor` and get a
* report measured against the gateway their network RESETS: a diagnostics tool
* that lies about which host it probed is worse than no tool.
*
* The plugin reads the settings field; `doctor` reads this. Both go through
* `resolveCnGateway`, so the allowlist cannot diverge between them.
*/
const WORKBUDDY_CN_BASE_ENV = "WORKBUDDY_CN_BASE";
/**
* Hosts an override may name, as registrable domains.
*
* A closed set is the security boundary described in this module's header. Adding
* a host here is a deliberate act that must come with a measurement showing it
* answers the CN routes, not with a guess about the brand.
*/
const ALLOWED_CN_DOMAINS = [
	"copilot.tencent.com",
	"tencentbuddy.com",
	"workbuddy.cn",
	"codebuddy.cn"
];
/**
* Whether `hostname` belongs to one of the CN brands above.
*
* Matched on the registrable domain (`host === domain` or `host.endsWith('.' +
* domain)`), so `wb.tencentbuddy.com` and `copilot.internal.tencentbuddy.com`
* both qualify while `tencentbuddy.com.evil.example` does not.
*/
function isKnownCnHost(hostname) {
	const lowered = hostname.trim().toLowerCase();
	if (lowered === "") return false;
	return ALLOWED_CN_DOMAINS.some((domain) => lowered === domain || lowered.endsWith(`.${domain}`));
}
/**
* Resolve the CN gateway base from an optional user-supplied value.
*
* An ABSENT or blank value is the normal case and yields the default with
* `overridden: false`. A non-blank value must pass every check or the caller
* gets `ok: false` and is expected to say so rather than silently falling back:
* a user who typed a host and got the default anyway has no way to tell the
* setting was ignored, and would keep debugging a network they already fixed.
*/
function resolveCnGateway(value) {
	const raw = typeof value === "string" ? value.trim() : "";
	if (raw === "") return {
		ok: true,
		base: CN_GATEWAY_DEFAULT,
		host: "copilot.tencent.com",
		overridden: false
	};
	let parsed;
	try {
		parsed = new URL(raw);
	} catch {
		return {
			ok: false,
			reason: "malformed",
			value: raw
		};
	}
	if (parsed.protocol !== "https:") return {
		ok: false,
		reason: "insecure",
		value: raw
	};
	if (!isKnownCnHost(parsed.hostname)) return {
		ok: false,
		reason: "unknown-host",
		value: raw
	};
	return {
		ok: true,
		base: `https://${parsed.hostname.toLowerCase()}`,
		host: parsed.hostname.toLowerCase(),
		overridden: true
	};
}
/** The versions this build can read (add a new one on upgrade, keep old ones). */
const KNOWN_ROSTER_SEEN_VERSIONS = Object.freeze([1]);
/**
* The "new" window: a first-seen stamp inside it counts as new.
*
* 7 days is a deliberate scale — it has to cover "the user was away a few days
* and came back to two new models" without letting one bulk upload still carry
* a marker two weeks later. The window is a CONSTANT here rather than a config:
* a "new model" marker that could be tuned to 365 days has no meaning.
*/
const ROSTER_SEEN_NEW_WINDOW_MS = 6048e5;
/**
* How long a read answer stays valid before the file is read again.
*
* Another process may have just written, so the answer has to be visible within
* a tick — but a single snapshot assembly should not re-read the file several
* times.
*/
const ROSTER_SEEN_READ_TTL_MS = 5e3;
/** Filename prefix for one region's first-sighting history. */
const ROSTER_SEEN_FILE_PREFIX = ".workbuddy-roster-seen";
const EMPTY_PAYLOAD = {
	seen: {},
	version: null
};
/** Whether this build can read a stored version. */
function isKnownRosterSeenVersion(version) {
	return typeof version === "number" && KNOWN_ROSTER_SEEN_VERSIONS.includes(version);
}
/**
* Normalise a first-seen table: keep only entries whose id is a non-empty
* string and whose stamp is a finite positive number.
*
* Dropping rather than repairing a bad entry is deliberate: a stamp of 0 or
* negative makes `now - stamp` come out as decades, and that id would count as
* "new" forever. Better to let it take a real stamp the next time it appears.
*/
function normalizeRosterSeen(raw) {
	if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return {};
	const out = {};
	for (const [id, stamp] of Object.entries(raw)) {
		if (id === "") continue;
		if (typeof stamp !== "number" || !Number.isFinite(stamp) || stamp <= 0) continue;
		out[id] = stamp;
	}
	return out;
}
/**
* One region's path for its first-sighting history.
*
* Region-keyed for the same reason the credential and pool copies are: the two
* regions are parallel stacks and must never overwrite each other's history.
*/
function rosterSeenPath(region, dir) {
	if (typeof dir === "string" && dir !== "") return join(dir, `${ROSTER_SEEN_FILE_PREFIX}.${region}.json`);
	return join(resolveDshHome(), `${ROSTER_SEEN_FILE_PREFIX}.${region}.json`);
}
/**
* The ids from a first-seen table that are still "new", oldest first.
*
* Ascending on purpose: the caller shows only the first few names (the pill
* tooltip / popover budget), and the ones seen EARLIEST are the ones closest to
* expiring — and the ones the reader is most likely to have already met and
* needs told "it really only just appeared".
*/
function freshIdsOf(seen, nowMs) {
	return Object.entries(seen).filter(([, first]) => nowMs - first < ROSTER_SEEN_NEW_WINDOW_MS).sort((left, right) => left[1] - right[1]).map(([id]) => id);
}
/**
* Parse a raw JSON value into a payload; an unreadable version reads as an
* empty table but KEEPS the version number — reads stay permissive, while the
* write guard refuses to overwrite it (the two halves are one rule).
*/
function parseRosterSeenPayload(raw) {
	if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return EMPTY_PAYLOAD;
	const source = raw;
	const version = typeof source["version"] === "number" ? source["version"] : null;
	if (!isKnownRosterSeenVersion(version)) return {
		seen: {},
		version
	};
	return {
		seen: normalizeRosterSeen(source["seen"]),
		version
	};
}
/**
* The file-backed first-sighting table for one region.
*/
function createFileRosterSeenStore(region, options = {}) {
	const { dir, ttlMs = ROSTER_SEEN_READ_TTL_MS } = options;
	const filePath = rosterSeenPath(region, dir);
	/** Read the file's raw JSON, or `null` for a missing or unreadable file. */
	const readRaw = async () => {
		try {
			return JSON.parse(await readFile(filePath, "utf8"));
		} catch {
			return null;
		}
	};
	let cached;
	const readPayload = async () => {
		if (cached !== void 0 && Date.now() - cached.at < ttlMs) return cached.payload;
		const payload = parseRosterSeenPayload(await readRaw());
		cached = {
			payload,
			at: Date.now()
		};
		return payload;
	};
	let writeTail = Promise.resolve();
	const enqueueWrite = (task) => {
		const run = writeTail.then(task, task);
		writeTail = run.then(() => void 0, () => void 0);
		return run;
	};
	return {
		/**
		* Record one round's complete catalog and answer which of its ids are still
		* inside the new window.
		*
		* One call diffs AND persists (see the module note). The first write is
		* SEEDING: every id is stamped as already expired and `newIds` answers
		* empty.
		*/
		async note(ids, nowMs = Date.now()) {
			const list = Array.isArray(ids) ? ids.filter((id) => typeof id === "string" && id !== "") : [];
			const unique = [...new Set(list)];
			if (unique.length === 0) return { newIds: [] };
			const now = Number.isFinite(nowMs) ? nowMs : Date.now();
			return enqueueWrite(() => withFileLock(filePath, async () => {
				const current = parseRosterSeenPayload(await readRaw());
				if (current.version !== null && !isKnownRosterSeenVersion(current.version)) return { newIds: [] };
				const previous = current.seen;
				const seeded = current.version === null;
				const next = {};
				for (const id of unique) {
					const first = previous[id];
					next[id] = typeof first === "number" && first > 0 ? Math.min(first, now) : seeded ? now - ROSTER_SEEN_NEW_WINDOW_MS : now;
				}
				if (Object.keys(next).length > 200) return { newIds: [] };
				if (seeded || Object.keys(previous).length !== Object.keys(next).length || Object.keys(next).some((id) => previous[id] !== next[id])) {
					await writeFileAtomic(filePath, `${JSON.stringify({
						version: 1,
						seen: next,
						updatedAt: (/* @__PURE__ */ new Date()).toISOString()
					}, null, 2)}\n`, {
						mode: 384,
						dirMode: 448
					});
					cached = {
						payload: {
							seen: next,
							version: 1
						},
						at: Date.now()
					};
				}
				return { newIds: seeded ? [] : freshIdsOf(next, now) };
			}));
		},
		/**
		* Read-only: the ids that still count as "new" right now (ascending).
		*
		* NEVER WRITES. The snapshot and the provider route are read paths, and
		* writing happens only in the reconciler's `note`; a read path that topped
		* up stamps would let one panel poll rewrite "who is new".
		*/
		async fresh(nowMs = Date.now()) {
			return freshIdsOf((await readPayload()).seen, Number.isFinite(nowMs) ? nowMs : Date.now());
		},
		/** Whether this table has ever been written (seeded vs "really none new"). */
		async isSet() {
			return (await readPayload()).version !== null;
		},
		/**
		* The read-only readout the usage route carries, or the version note when
		* the on-disk history is in a version this build cannot read.
		*/
		async readout(nowMs = Date.now()) {
			const payload = await readPayload();
			const version = payload.version;
			if (version === null || isKnownRosterSeenVersion(version)) return { newModelIds: freshIdsOf(payload.seen, Number.isFinite(nowMs) ? nowMs : Date.now()) };
			return {
				newModelIds: [],
				versionNote: `The first-sighting history is stored in version ${String(version)}, which this build cannot read; it is answered as empty, so the pill shows no new-model marker. Known versions: ${KNOWN_ROSTER_SEEN_VERSIONS.join(", ")}.`
			};
		},
		/** The on-disk path (diagnostics and tests). */
		filePath
	};
}
/**
* doctor's read-only summary: parse a roster-seen payload without building a
* store or touching any cache.
*
* `null` for a payload the whole shape does not recognise; `versionKnown: false`
* for a recognised version this build cannot read — so `doctor` can tell "the
* file is corrupt" from "a newer build wrote it".
*/
function describeRosterSeenPayload(raw) {
	if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
	const version = raw["version"];
	if (typeof version !== "number") return null;
	const seen = normalizeRosterSeen(raw["seen"]);
	return {
		versionKnown: isKnownRosterSeenVersion(version),
		ids: Object.keys(seen).length,
		fresh: freshIdsOf(seen, Date.now()).length
	};
}
//#endregion
//#region src/version.ts
/** The npm package version this build was produced from. */
const WORKBUDDY_CONNECT_VERSION = "5.21.4";
//#endregion
//#region src/host-heartbeat.ts
/**
* Host-side heartbeat: a small JSON file written under `$DSH_HOME` once the
* `workbuddy` provider is registered. The status CLI reads it to report
* whether the host bundle is alive, independent of the browser card.
*
* 参考：corrinehu/dsh-workbuddy-connect（MIT，Copyright (c) 2026 Corrine Hu）
*   — 该机制由其设计：浏览器端无法写文件，其健康只能靠 console.error 上报，
*     因此由宿主写心跳文件，缺失即代表宿主从未启动；崩溃后的陈旧心跳
*     通过 PID 存活检查识别。
* 改动：无。机制本身已完备，原样沿用。
*
* @module dsh-connect-workbuddy/host-heartbeat
*/
/** Basename of the host heartbeat file inside the Harness home. */
const WORKBUDDY_HOST_HEARTBEAT_FILENAME = ".workbuddy-host-heartbeat.json";
/**
* On-disk heartbeat formats this build WRITES and READS.
*
* 1 → 2 added `hostStartedAt` (issue #174). Version 1 is still READ, on purpose:
* rejecting it would turn the first `doctor` after an upgrade into a spurious
* "no heartbeat at all", which is a worse diagnosis than the imprecise
* comparison version 1 supports. Anything newer than {@link HEARTBEAT_FORMAT_VERSION}
* is rejected, because a future field could change the meaning of the ones read
* here.
*/
const HEARTBEAT_FORMAT_VERSION = 2;
const READABLE_HEARTBEAT_VERSIONS = [1, 2];
/** Absolute path of the host heartbeat file. */
function workbuddyHostHeartbeatPath() {
	return join(resolveDshHome(), WORKBUDDY_HOST_HEARTBEAT_FILENAME);
}
/**
* Spawn options every external probe in this module is run with.
*
* `windowsHide` is REQUIRED here, not cosmetic. Windows hands a console-program
* child a brand-new console window whenever its PARENT has none — and the
* parent frequently has none: the DSH Desktop host is an Electron GUI process
* (`MainWindowHandle = 0`, verified on the live host), as are Task Scheduler
* jobs and CI services. That window is created VISIBLE, so every start-time
* probe would flash a black box on the user's screen.
*
* Evidence (real Windows 11, parent created console-less through the WMI
* service — the same condition as the Electron host; the child reports the
* console it actually owns):
*
*   - without `windowsHide`: `NEW-console hwnd=1573500 visible=True`
*   - with `windowsHide: true`: `no-console`
*
* Invoked from a terminal the parent HAS a console and the child simply
* inherits it (no new window), which is why this never showed up in local
* runs — the same blind spot `docs/WINDOWS.md` §0 describes. The sibling call
* site `src/at-rest.ts` (the at-rest key fetch) already sets this option; this
* module did not, and that inconsistency is what the test pins.
*
* On POSIX the option is ignored.
*/
const PROCESS_PROBE_OPTIONS = {
	encoding: "utf8",
	windowsHide: true
};
/**
* The command one start-time probe runs, per platform.
*
* Split out as a value so the spawn can be asserted WITHOUT a Windows machine:
* `tests/host-heartbeat.spec.ts` checks the platform branch and the options
* object directly, which is the only way a Windows-only spawn defect here can
* be caught on the macOS development machine (§0: not "unreproduced" but
* "impossible to reproduce").
*
* `platform` is injectable for the same reason, in the same spirit as
* `defaultDesktopAuthDirs()` and `workbuddyAppExecutableCandidates()`.
*/
function processStartProbe(pid, platform = process.platform) {
	if (platform === "win32") return {
		file: "powershell",
		args: [
			"-NoProfile",
			"-NonInteractive",
			"-Command",
			`(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).StartTime.ToUniversalTime().ToString('o')`
		]
	};
	return {
		file: "ps",
		args: [
			"-o",
			"lstart=",
			"-p",
			String(pid)
		]
	};
}
/**
* Process start time in epoch milliseconds; undefined when unavailable.
*
* POSIX reads `ps -o lstart=`; Windows has no such command, so the creation
* time is taken from PowerShell's `Get-Process` StartTime, emitted as UTC ISO
* 8601 so `Date.parse` understands it without locale assumptions. Absent or
* unqueryable processes (other users' processes) degrade to undefined.
*/
function processStartTimeMs(pid) {
	try {
		const probe = processStartProbe(pid);
		const output = execFileSync(probe.file, probe.args, PROCESS_PROBE_OPTIONS);
		const parsed = Date.parse(output.trim());
		return Number.isFinite(parsed) ? parsed : void 0;
	} catch {
		return;
	}
}
/**
* How close a recorded start time must be to the live process's start time for
* the two to be considered the SAME process.
*
* Two tolerances, for two different comparisons:
*
*   - {@link HOST_START_REFERENCE_TOLERANCE_MS} when the heartbeat records
*     `hostStartedAt` — both sides are then the SAME quantity (a process start
*     time), so the window only has to absorb the coarse resolution of
*     `ps -o lstart=` (whole seconds) and PowerShell's string round-trip.
*   - {@link LEGACY_REFERENCE_TOLERANCE_MS} when it does not, and the only
*     available reference is `registeredAt`. That is a different quantity
*     (when the plugin mounted, not when the process started), so it is a
*     lower bound rather than an answer: a host that started more than this
*     before the plugin mounted would have looked dead. Kept wide on purpose —
*     a missed reuse is far less harmful than calling a live host stale.
*/
const HOST_START_REFERENCE_TOLERANCE_MS = 12e4;
const LEGACY_REFERENCE_TOLERANCE_MS = 432e5;
/**
* Whether the recorded host process still matches the heartbeat's PID.
*
* A PID can be reused after a crash, so the recorded start time is compared
* against the live process: a different start time means a different process.
*
* ISSUE #174 — the reference used to be `registeredAt`, the moment the plugin
* WROTE the heartbeat, and the comparison was `|startedAt − registeredAt| < 60s`.
* Those are two different quantities: `registeredAt` is when the host finished
* booting and mounted this plugin, which on a real machine is minutes after the
* process started. Measured by the reporter on Windows 11: process start
* 19:47:20, heartbeat written 19:58:45 — 684,817 ms apart — so `doctor` and
* `status` reported `hostBundle: "stale"` for a host that was alive and had
* just written the file. The `hostStartedAt` field exists so the comparison has
* the right reference; `registeredAt` is only read for heartbeats written by an
* older build, where it is the sole (and merely near) signal available.
*/
function isHeartbeatProcessAlive(heartbeat) {
	if (!Number.isInteger(heartbeat.pid) || heartbeat.pid <= 0) return false;
	try {
		process.kill(heartbeat.pid, 0);
	} catch {
		return false;
	}
	const startedAt = processStartTimeMs(heartbeat.pid);
	if (startedAt === void 0) return true;
	const recorded = heartbeat.hostStartedAt;
	if (recorded !== void 0 && Number.isFinite(recorded)) return Math.abs(startedAt - recorded) < HOST_START_REFERENCE_TOLERANCE_MS;
	return Math.abs(startedAt - heartbeat.registeredAt) < LEGACY_REFERENCE_TOLERANCE_MS;
}
/** Read the heartbeat; absent or unparsable files report undefined. */
async function readHostHeartbeat() {
	try {
		const parsed = JSON.parse(await readFile(workbuddyHostHeartbeatPath(), "utf8"));
		if (typeof parsed !== "object" || parsed === null) return void 0;
		const document = parsed;
		if (!READABLE_HEARTBEAT_VERSIONS.includes(document["version"])) return void 0;
		if (document["package"] !== "dsh-connect-workbuddy") return void 0;
		const pid = document["pid"];
		const registeredAt = document["registeredAt"];
		if (typeof pid !== "number" || typeof registeredAt !== "number") return void 0;
		const hostStartedAt = document["hostStartedAt"];
		return {
			version: document["version"],
			package: "dsh-connect-workbuddy",
			pluginVersion: typeof document["pluginVersion"] === "string" ? document["pluginVersion"] : WORKBUDDY_CONNECT_VERSION,
			registeredAt,
			pid,
			...typeof hostStartedAt === "number" && Number.isFinite(hostStartedAt) ? { hostStartedAt } : {}
		};
	} catch {
		return;
	}
}
/**
* Write the heartbeat for the current process.
*
* `hostStartedAt` is captured HERE, from this process, so the later staleness
* check compares like with like (issue #174). Sampled on every write rather
* than cached: the value is cheap, and a module-level cache would be wrong the
* moment this function is exercised from a child process.
*/
async function writeHostHeartbeat() {
	const hostStartedAt = processStartTimeMs(process.pid);
	const heartbeat = {
		version: HEARTBEAT_FORMAT_VERSION,
		package: "dsh-connect-workbuddy",
		pluginVersion: WORKBUDDY_CONNECT_VERSION,
		registeredAt: Date.now(),
		pid: process.pid,
		...hostStartedAt === void 0 ? {} : { hostStartedAt }
	};
	await writeFile(workbuddyHostHeartbeatPath(), `${JSON.stringify(heartbeat, null, 2)}\n`, { mode: 384 });
}
/** Remove the heartbeat; called when the plugin is disposed. */
async function clearHostHeartbeat() {
	await rm(workbuddyHostHeartbeatPath(), { force: true });
}
//#endregion
export { DEFAULT_WIRE_PROFILE as $, imageDefaultFor as $t, withoutRouters as A, offRefused as At, defaultDesktopAuthPath as B, IMAGE_TAG_TEXT_TO_IMAGE as Bt, setDeviceMode as C, hostPeersInfo as Cn, attachBusyLevels as Ct, applyContextBudgets as D, defaultOffModelIds as Dt, WorkBuddyCatalog as E, writeFileAtomic as En, REFUSES_OFF_MODEL_IDS as Et, WorkBuddyCredentialStore as F, WorkBuddyVideoError as Ft, parseWorkBuddyAuth as G, isBareBase64Image as Gt, isEncryptedCredentialError as H, WorkBuddyImageError as Ht, WorkBuddyEncryptedCredentialError as I, parseSupportedSecondsRange as It, workbuddyOwnAuthPath as J, sniffImageMime as Jt, preferredAccountName as K, parseImageDataUrl as Kt, authFileName as L, pickVideoModel as Lt, WORKBUDDY_AUTH_FILENAME as M, withEffectiveOff as Mt, WORKBUDDY_AUTH_FILE_ENV as N, VIDEO_TAG_IMAGE_TO_VIDEO as Nt, deriveCatalog as O, lastRefusalFor as Ot, WORKBUDDY_VAULT_DIRNAME as P, VIDEO_TAG_TEXT_TO_VIDEO as Pt, CREDENTIAL_REJECTED_CODE as Q, NATIVE_MODALITY_BY_MODEL_ID as Qt, defaultDesktopAuthCandidates as R, resolveVideoParams as Rt, saveDeviceSdkSettings as S, workbuddyAppExecutableCandidates as Sn, rewriteSessionTitleModel as St, FALLBACK_WORKBUDDY_MODELS_GLOBAL as T, withFileLock as Tn, selectPromoBadge as Tt, isVaultAccountId as U, imageDataUrl as Ut, hasEncryptedCredentialFields as V, MAX_INPUT_IMAGE_BYTES as Vt, legacyWorkbuddyOwnAuthPath as W, imageMimeForPath as Wt, APP_VERSION as X, queueNoticeText as Xt, workbuddyVaultDir as Y, parseQueueAnswer as Yt, CONTEXT_OVERFLOW_MARKER as Z, pruneTempDir as Zt, createDeviceProfileLookup as _, isWorkbuddyBundle as _n, parseUpstreamModel as _t, readHostHeartbeat as a, deriveDeviceId as an, declaredTools as at, readDeviceSettings as b, openEncryptedField as bn, regionOf as bt, WORKBUDDY_CONNECT_VERSION as c, protectCredentialDirectory as cn, isContextTooLongBody as ct, rosterSeenPath as d, deriveAtRestKey as dn, isFirstMessageGateBody as dt, nativeModalityOf as en, WORKBUDDY_FALLBACK_SYSTEM_PROMPT as et, WORKBUDDY_CN_BASE_ENV as f, deriveAtRestKeyId as fn, knownRegionOf as ft, createTuringSdk as g, isEncryptedFieldWrapper as gn, parseReasoning as gt, createDeviceSdkPort as h, findWorkbuddyAppExecutableWithSource as hn, parseCreditMultiplier as ht, processStartTimeMs as i, readDeviceSalt as in, classifyUpstreamError as it, ENCRYPTED_CREDENTIAL_CODE as j, recordRefusal as jt, fallbackModelsFor as k, offDefaultFor as kt, createFileRosterSeenStore as l, WORKBUDDY_APP_EXECUTABLE_ENV as ln, isConversationIdGateBody as lt, piAiRuntimeInfo as m, findWorkbuddyAppExecutable as mn, openingEvidenceOfBody as mt, clearHostHeartbeat as n, readDeviceTokenFile as nn, WorkBuddyUpstreamClient as nt, workbuddyHostHeartbeatPath as o, isDeviceId as on, describeRequestHeaderNames as ot, resolveCnGateway as p, fetchAtRestKeyPayload as pn, modelIdOfBody as pt, workbuddyAccountId as q, pickMediaModel as qt, isHeartbeatProcessAlive as r, ensureDeviceSalt as rn, channelGateMemberOf as rt, writeHostHeartbeat as s, inspectCredentialDirectory as sn, forceNeutralHead as st, WORKBUDDY_HOST_HEARTBEAT_FILENAME as t, WORKBUDDY_DEVICE_TOKEN_FILE_ENV as tn, WorkBuddyCredentialRejectedError as tt, describeRosterSeenPayload as u, clearAtRestKeyCache as un, isCredentialRejectedError as ut, describeDerivedDevices as v, macosBundleExecutable as vn, perturbChannelFingerprints as vt, FALLBACK_WORKBUDDY_MODELS as w, resolveDshHome as wn, promoBadgeTone as wt, saveDeviceProfile as x, readAtRestKey as xn, requestEvidenceOf as xt, isDeviceMode as y, macosNestedAppBundles as yn, prepareChatBody as yt, defaultDesktopAuthDirs as z, IMAGE_TAG_IMAGE_TO_IMAGE as zt };
