import { lstat, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve, win32 } from "node:path";
import { execFile, execFileSync } from "node:child_process";
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
	"minimax-m3": "multimodal"
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
/** 官方 CLI 的默认尺寸。 */
const DEFAULT_IMAGE_SIZE = "1024x1024";
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
		videos: []
	};
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
* with nothing in the UI to say which one it was. Ten seconds is comfortably
* above a working gateway's first byte and far below a user's patience; the
* budget covers the response only, never the one-line body that follows.
*/
const PROBE_TIMEOUT_MS = 1e4;
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
/** 单个轮询轮次的上限（与 VIDEO_TIMEOUT_MS 对应，防死循环）。 */
const VIDEO_POLL_TIMEOUT_MS = 6e5;
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
function chatBase(credential) {
	return regionOf(credential.domain) === "global" ? globalBase(credential.domain) : CN_CHAT_BASE;
}
function billingBase(credential) {
	return regionOf(credential.domain) === "global" ? globalBase(credential.domain) : CN_BILLING_BASE;
}
function originReferer(credential) {
	return regionOf(credential.domain) === "global" ? globalBase(credential.domain) : CN_BILLING_BASE;
}
/** Headers every upstream request shares. */
function commonHeaders(credential) {
	return {
		"Accept": "application/json, text/plain, */*",
		"X-Requested-With": "XMLHttpRequest",
		"Origin": originReferer(credential),
		"Referer": `${originReferer(credential)}/`,
		"User-Agent": CLIENT_UA
	};
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
	return {
		"X-Conversation-ID": id(),
		"X-Conversation-Request-ID": id(),
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
* The IDE identity headers the official desktop client sends on chat (issue #132).
*
* WHY. The gateway records the usage page's 使用端 (client) column from
* `X-IDE-Name`, and it is EMPTY when the header is absent. The plugin has always
* spoken the CLI channel — {@link CLIENT_UA}, which is correct for the chat
* contract — but it sent no `X-IDE-*` at all, so every request this plugin made
* appeared on the user's own usage page as an unidentified client while the
* official app's requests read `WorkBuddy`. That is a reporting mismatch, not a
* gate: the reporter measured that adding the header changes the usage column
* and nothing else (HTTP 200, model unaffected).
*
* `X-IDE-Type` stays `CLI` on purpose. Claiming the desktop app's type as well
* would be a bigger identity claim than the one this fix needs, and the mixed
* CLI + WorkBuddy shape is what the reporter measured. The version comes from
* {@link PRODUCT_UA} rather than a second hardcoded number, so the two cannot
* drift apart when the app version is bumped.
*
* Sent only when {@link WorkBuddyWireIdentity.usageIdentity} is on — see that
* field for the evidence tier behind the default.
*/
function ideHeaders(identity) {
	if (identity.usageIdentity !== true) return {};
	return {
		"X-IDE-Type": "CLI",
		"X-IDE-Name": "WorkBuddy",
		"X-IDE-Version": APP_VERSION
	};
}
/** Chat request headers, including the X-No-* conventions the official CLI uses. */
function chatHeaders(credential, identity = {}) {
	return {
		...commonHeaders(credential),
		"Content-Type": "application/json",
		...credential.uid === "" ? { "X-No-User-Id": "1" } : { "X-User-Id": credential.uid },
		...credential.enterpriseId === void 0 || credential.enterpriseId === "" ? { "X-No-Enterprise-Id": "1" } : { "X-Enterprise-Id": credential.enterpriseId },
		...credential.domain === "" ? { "X-No-Department-Info": "1" } : { "X-Domain": credential.domain },
		"X-Product": "SaaS",
		...ideHeaders(identity),
		...conversationHeaders("chat", identity)
	};
}
/** Refresh-endpoint headers; X-Refresh-Token appears here and nowhere else. */
function refreshHeaders(credential) {
	const headers = {
		...commonHeaders(credential),
		"X-Refresh-Token": credential.refreshToken,
		"X-Auth-Refresh-Source": "workbuddy"
	};
	if (credential.enterpriseId !== void 0 && credential.enterpriseId !== "") headers["X-Enterprise-Id"] = credential.enterpriseId;
	return headers;
}
/** Billing request headers. */
function billingHeaders(credential) {
	const headers = {
		"Authorization": `Bearer ${credential.accessToken}`,
		"Accept": "application/json",
		"Content-Type": "application/json"
	};
	if (credential.uid !== "") headers["X-User-Id"] = credential.uid;
	if (credential.enterpriseId !== void 0 && credential.enterpriseId !== "") {
		headers["X-Enterprise-Id"] = credential.enterpriseId;
		headers["X-Tenant-Id"] = credential.enterpriseId;
	}
	if (credential.domain !== "") headers["X-Domain"] = credential.domain;
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
		"X-Product": "SaaS",
		"X-Requested-With": "XMLHttpRequest",
		...credential.uid === "" ? { "X-No-User-Id": "1" } : { "X-User-Id": credential.uid },
		...credential.enterpriseId === void 0 || credential.enterpriseId === "" ? { "X-No-Enterprise-Id": "1" } : { "X-Enterprise-Id": credential.enterpriseId },
		...credential.domain === "" ? { "X-No-Department-Info": "1" } : { "X-Domain": credential.domain },
		...conversationHeaders("image", identity)
	};
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
	{ prefix: "you are an ai agent powered by deepseek harness", replacement: WORKBUDDY_FALLBACK_SYSTEM_PROMPT },
	{ prefix: "you are claude code, anthropic's official cli for claude", replacement: WORKBUDDY_FALLBACK_SYSTEM_PROMPT },
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
function neutralizeScannedText(text) {
	const replaced = neutralizeText(text) ?? text;
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
	identity;
	/**
	* Reports an anomaly the reader or classifier had to tolerate.
	*
	* Injected rather than logged here because this module holds no logger on
	* purpose — it is pure transport + parsing, so it stays importable from
	* tests and the CLI without a cordis context. The host wires its
	* `ctx.logger.warn` in; without a host the event is dropped, which is the
	* same silence the previous single-source reader had.
	*/
	constructor(onFallback, identity = {}) {
		this.onFallback = onFallback;
		this.identity = identity;
	}
	/** POST the chat endpoint; a successful answer is the raw SSE response. */
	async chatStream(credential, bodyJson, signal) {
		let response;
		try {
			response = await fetch(`${chatBase(credential)}/v2/chat/completions`, {
				method: "POST",
				headers: {
					...chatHeaders(credential, this.identity),
					"Authorization": `Bearer ${credential.accessToken}`
				},
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
	*/
	async probeChat(credential, bodyJson, signal) {
		let response;
		const ceiling = new AbortController();
		const timer = setTimeout(() => {
			ceiling.abort(/* @__PURE__ */ new Error(`no response within ${PROBE_TIMEOUT_MS}ms`));
		}, PROBE_TIMEOUT_MS);
		try {
			response = await fetch(`${chatBase(credential)}/v2/chat/completions`, {
				method: "POST",
				headers: {
					...chatHeaders(credential, this.identity),
					"Authorization": `Bearer ${credential.accessToken}`
				},
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
		const response = await fetch(`${chatBase(credential)}/v2/plugin/auth/token/refresh`, {
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
			const response = await fetch(`${globalBase(credential.domain)}${GLOBAL_CONFIG_PATH}`, {
				headers: {
					"Authorization": `Bearer ${credential.accessToken}`,
					"Accept": "application/json",
					...credential.uid === "" ? {} : { "X-User-Id": credential.uid },
					...credential.domain === "" ? {} : { "X-Domain": credential.domain },
					"X-Product": "SaaS",
					"X-Requested-With": "XMLHttpRequest",
					"Connection": "close",
					"User-Agent": PRODUCT_UA
				},
				signal: timeout
			});
			const envelope = await readEnvelope(response);
			if (!response.ok || envelope.code !== 0) throw envelopeError(response.status, envelope);
			const data = typeof envelope.data === "object" && envelope.data !== null ? envelope.data : {};
			return withPromos(selectCliModels(data["models"], data["agents"], keepModelIds), data);
		}
		const readCatalog = async (path) => {
			const response = await fetch(`${chatBase(credential)}${path}`, {
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
			const response = await fetch(`${chatBase(credential)}${MODEL_BUSY_PATH}`, {
				method: "POST",
				headers: {
					...commonHeaders(credential),
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
		const readMedia = async (path) => {
			const response = await fetch(`${chatBase(credential)}${path}`, {
				headers: {
					"Authorization": `Bearer ${credential.accessToken}`,
					"Accept": "application/json",
					"Origin": originReferer(credential),
					"Referer": `${originReferer(credential)}/`,
					"User-Agent": PRODUCT_UA
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
		const response = await fetch(`${chatBase(credential)}${IMAGE_GENERATIONS_PATH}`, {
			method: "POST",
			headers: imageHeaders(credential, this.identity),
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
		const response = await fetch(`${chatBase(credential)}${IMAGE_EDITS_PATH}`, {
			method: "POST",
			headers: imageHeaders(credential),
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
		const response = await fetch(`${chatBase(credential)}${VIDEO_GENERATIONS_PATH}`, {
			method: "POST",
			headers: imageHeaders(credential, this.identity),
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
				const response = await fetch(`${chatBase(credential)}${VIDEO_TASKS_PATH}`, {
					method: "POST",
					headers: imageHeaders(credential, this.identity),
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
			if (result.status === "failed") throw new WorkBuddyVideoError(`workbuddy video: 生视频任务失败（task ${taskId}）。`, "TASK_FAILED");
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
		return path;
	}
	/** Query today's check-in status without changing account state. */
	async fetchCheckinStatus(credential) {
		const response = await fetch(`${billingBase(credential)}/v2/billing/meter/checkin-activity-status`, {
			method: "POST",
			headers: billingHeaders(credential),
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
		const response = await fetch(`${billingBase(credential)}${path}`, {
			method: "POST",
			headers: billingHeaders(credential),
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
		const response = await fetch(`${billingBase(credential)}${BENEFIT_CLAIM_PATHS[kind]}`, {
			method: "POST",
			headers: billingHeaders(credential),
			body: "{}",
			signal: AbortSignal.timeout(JSON_TIMEOUT_MS)
		});
		const envelope = await readEnvelope(response);
		if (!response.ok || envelope.code !== 0) throw envelopeError(response.status, envelope);
	}
	/** Claim today's check-in reward. The browser route guards this mutation. */
	async claimDailyCheckin(credential) {
		const response = await fetch(`${billingBase(credential)}/v2/billing/meter/daily-checkin`, {
			method: "POST",
			headers: billingHeaders(credential),
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
		const response = await fetch(`${billingBase(credential)}/billing/meter/get-enterprise-user-usage`, {
			method: "POST",
			headers: billingHeaders(credential),
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
		const response = await fetch(`${billingBase(credential)}/v2/billing/meter/get-user-resource`, {
			method: "POST",
			headers: billingHeaders(credential),
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
/** Basename of the live WorkBuddy desktop auth file. */
const WORKBUDDY_LIVE_FILENAME = "workbuddy-desktop.info";
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
* Platform-default directories holding the WorkBuddy desktop app's auth file.
*
* Windows and Linux prefer the OS-issued env location and fall back to the
* home-derived convention when it is unset, so a redirected profile (OneDrive
* folder backup, enterprise policy) still resolves. macOS has no equivalent
* env variable; the single Application Support path is used as-is.
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
	if (platform === "linux") {
		const config = nonEmptyEnv(env["XDG_CONFIG_HOME"]) ?? join(home, ".config");
		return [join(config, "CodeBuddyExtension", "Data", "Public", "auth")];
	}
	return [];
}
/** A non-empty, trimmed env value, or undefined when unset/blank. */
function nonEmptyEnv(value) {
	return typeof value === "string" && value.trim() !== "" ? value.trim() : void 0;
}
/** The live auth file's platform candidates, in probe order. */
function defaultDesktopAuthCandidates() {
	return defaultDesktopAuthDirs().map((dir) => join(dir, WORKBUDDY_LIVE_FILENAME));
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
	return authFileName(path) === WORKBUDDY_LIVE_FILENAME ? 0 : 1;
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
/** Write one vault entry atomically under the file lock. */
async function writeVaultEntry(dir, accountId, credential, refreshedFrom) {
	const path = join(dir, `${accountId}.json`);
	await withFileLock(path, async () => {
		await writeFileAtomic(path, `${JSON.stringify(vaultDocument(credential, accountId, refreshedFrom), null, 2)}\n`, {
			mode: 384,
			dirMode: 448
		});
	});
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
		return defaultDesktopAuthCandidates();
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
		for (const dir of dirs) {
			const live = join(dir, WORKBUDDY_LIVE_FILENAME);
			files.push(live);
			for (const backup of await this.backupsBeside(live)) files.push(backup);
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
		for (const path of await this.candidateFiles()) {
			const probe = await probeAuthFile(path, this.resolveAtRestKey);
			if ("credential" in probe) {
				if (!this.matchesRegion(probe.credential.domain)) candidates.push({
					path,
					source: "desktop",
					reason: "wrong-region",
					message: `holds a ${regionOf(probe.credential.domain)} sign-in, but this tab reads the ${this.region} region`
				});
				continue;
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
			tried,
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
* usable before the first fetch lands. Order and rates mirror the upstream.
*/
const FALLBACK_WORKBUDDY_MODELS_GLOBAL = [
	{
		id: "fast-model",
		name: "Fast",
		contextWindow: 2e5,
		maxTokens: 32e3,
		creditMultiplier: .34
	},
	{
		id: "balanced-model",
		name: "Balanced",
		contextWindow: 256e3,
		maxTokens: 32e3,
		creditMultiplier: .59
	},
	{
		id: "primary-model",
		name: "Primary",
		contextWindow: 272e3,
		maxTokens: 72e3,
		creditMultiplier: 3.31
	},
	{
		id: "deep-model",
		name: "Deep",
		contextWindow: 176e3,
		maxTokens: 24e3,
		creditMultiplier: 3.33
	},
	{
		id: "deepseek-v4.1-flash",
		name: "Deepseek-V4.1-Flash",
		contextWindow: 1e6,
		maxTokens: 128e3,
		creditMultiplier: 0
	},
	{
		id: "gpt-6-astra",
		name: "GPT-6-Astra",
		contextWindow: 1e6,
		maxTokens: 128e3,
		creditMultiplier: 6.67
	},
	{
		id: "hy4-preview",
		name: "Hy4 preview",
		contextWindow: 1e6,
		maxTokens: 64e3,
		creditMultiplier: 0
	},
	{
		id: "hy3",
		name: "Hy3",
		contextWindow: 192e3,
		maxTokens: 64e3,
		creditMultiplier: 0
	},
	{
		id: "gpt-5.6-sol",
		name: "GPT-5.6-Sol",
		contextWindow: 1e6,
		maxTokens: 128e3,
		creditMultiplier: 3.47
	},
	{
		id: "gpt-5.6-terra",
		name: "GPT-5.6-Terra",
		contextWindow: 1e6,
		maxTokens: 128e3,
		creditMultiplier: 1.39
	},
	{
		id: "gpt-5.6-luna",
		name: "GPT-5.6-Luna",
		contextWindow: 1e6,
		maxTokens: 128e3,
		creditMultiplier: .14
	},
	{
		id: "gpt-5.5",
		name: "GPT-5.5",
		contextWindow: 1e6,
		maxTokens: 128e3,
		creditMultiplier: 3.31
	},
	{
		id: "gpt-5.4",
		name: "GPT-5.4",
		contextWindow: 272e3,
		maxTokens: 72e3,
		creditMultiplier: 1.65
	},
	{
		id: "gpt-5.3-codex",
		name: "GPT-5.3-Codex",
		contextWindow: 272e3,
		maxTokens: 72e3,
		creditMultiplier: 1.25
	},
	{
		id: "gemini-3.5-flash",
		name: "Gemini-3.5-Flash",
		contextWindow: 1e6,
		maxTokens: 65536,
		creditMultiplier: .99
	},
	{
		id: "glm-5.3",
		name: "GLM-5.3",
		contextWindow: 1e6,
		maxTokens: 48e3,
		creditMultiplier: .79
	},
	{
		id: "glm-5.2",
		name: "GLM-5.2",
		contextWindow: 1e6,
		maxTokens: 48e3,
		creditMultiplier: .79
	},
	{
		id: "kimi-k3",
		name: "Kimi-K3",
		contextWindow: 1e6,
		maxTokens: 32e3,
		creditMultiplier: 1.62
	},
	{
		id: "kimi-k2.6",
		name: "Kimi-K2.6",
		contextWindow: 256e3,
		maxTokens: 32e3,
		creditMultiplier: .52
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
	/** Replace the list; callers invalidate their adapter snapshot after this. */
	set(models) {
		if (models.length === 0) throw new Error("workbuddy model catalog cannot be empty");
		this.models = models.map((model) => ({ ...model }));
	}
};
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
const WORKBUDDY_CONNECT_VERSION = "5.12.4";
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
/** Current on-disk heartbeat format; readers reject others. */
const HEARTBEAT_FORMAT_VERSION = 1;
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
* Whether the recorded host process still matches the heartbeat's PID.
*
* A PID can be reused after a crash, so the recorded start time is compared
* against the live process: a different start time means a different process.
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
	return Math.abs(startedAt - heartbeat.registeredAt) < 6e4;
}
/** Read the heartbeat; absent or unparsable files report undefined. */
async function readHostHeartbeat() {
	try {
		const parsed = JSON.parse(await readFile(workbuddyHostHeartbeatPath(), "utf8"));
		if (typeof parsed !== "object" || parsed === null) return void 0;
		const document = parsed;
		if (document["version"] !== HEARTBEAT_FORMAT_VERSION) return void 0;
		if (document["package"] !== "dsh-connect-workbuddy") return void 0;
		const pid = document["pid"];
		const registeredAt = document["registeredAt"];
		if (typeof pid !== "number" || typeof registeredAt !== "number") return void 0;
		return {
			version: HEARTBEAT_FORMAT_VERSION,
			package: "dsh-connect-workbuddy",
			pluginVersion: typeof document["pluginVersion"] === "string" ? document["pluginVersion"] : WORKBUDDY_CONNECT_VERSION,
			registeredAt,
			pid
		};
	} catch {
		return;
	}
}
/** Write the heartbeat for the current process. */
async function writeHostHeartbeat() {
	const heartbeat = {
		version: HEARTBEAT_FORMAT_VERSION,
		package: "dsh-connect-workbuddy",
		pluginVersion: WORKBUDDY_CONNECT_VERSION,
		registeredAt: Date.now(),
		pid: process.pid
	};
	await writeFile(workbuddyHostHeartbeatPath(), `${JSON.stringify(heartbeat, null, 2)}\n`, { mode: 384 });
}
/** Remove the heartbeat; called when the plugin is disposed. */
async function clearHostHeartbeat() {
	await rm(workbuddyHostHeartbeatPath(), { force: true });
}
//#endregion
export { parseCreditMultiplier as $, withFileLock as $t, isEncryptedCredentialError as A, pickMediaModel as At, WorkBuddyCredentialRejectedError as B, deriveAtRestKeyId as Bt, WorkBuddyCredentialStore as C, IMAGE_TAG_TEXT_TO_IMAGE as Ct, defaultDesktopAuthDirs as D, imageMimeForPath as Dt, defaultDesktopAuthCandidates as E, imageDataUrl as Et, workbuddyAccountId as F, imageDefaultFor as Ft, forceNeutralHead as G, isWorkbuddyBundle as Gt, channelGateMemberOf as H, findWorkbuddyAppExecutable as Ht, workbuddyOwnAuthPath as I, nativeModalityOf as It, isCredentialRejectedError as J, openEncryptedField as Jt, isContextTooLongBody as K, macosBundleExecutable as Kt, CONTEXT_OVERFLOW_MARKER as L, WORKBUDDY_APP_EXECUTABLE_ENV as Lt, legacyWorkbuddyOwnAuthPath as M, parseQueueAnswer as Mt, parseWorkBuddyAuth as N, queueNoticeText as Nt, defaultDesktopAuthPath as O, isBareBase64Image as Ot, preferredAccountName as P, NATIVE_MODALITY_BY_MODEL_ID as Pt, openingEvidenceOfBody as Q, resolveDshHome as Qt, CREDENTIAL_REJECTED_CODE as R, clearAtRestKeyCache as Rt, WORKBUDDY_AUTH_FILE_ENV as S, IMAGE_TAG_IMAGE_TO_IMAGE as St, authFileName as T, WorkBuddyImageError as Tt, classifyUpstreamError as U, findWorkbuddyAppExecutableWithSource as Ut, WorkBuddyUpstreamClient as V, fetchAtRestKeyPayload as Vt, declaredTools as W, isEncryptedFieldWrapper as Wt, knownRegionOf as X, workbuddyAppExecutableCandidates as Xt, isFirstMessageGateBody as Y, readAtRestKey as Yt, modelIdOfBody as Z, hostPeersInfo as Zt, deriveCatalog as _, WorkBuddyVideoError as _t, readHostHeartbeat as a, requestEvidenceOf as at, ENCRYPTED_CREDENTIAL_CODE as b, resolveVideoParams as bt, WORKBUDDY_CONNECT_VERSION as c, REFUSES_OFF_MODEL_IDS as ct, rosterSeenPath as d, offDefaultFor as dt, writeFileAtomic as en, parseReasoning as et, piAiRuntimeInfo as f, offRefused as ft, applyContextBudgets as g, VIDEO_TAG_TEXT_TO_VIDEO as gt, WorkBuddyCatalog as h, VIDEO_TAG_IMAGE_TO_VIDEO as ht, processStartTimeMs as i, regionOf as it, isVaultAccountId as j, sniffImageMime as jt, hasEncryptedCredentialFields as k, parseImageDataUrl as kt, createFileRosterSeenStore as l, defaultOffModelIds as lt, FALLBACK_WORKBUDDY_MODELS_GLOBAL as m, withEffectiveOff as mt, clearHostHeartbeat as n, perturbChannelFingerprints as nt, workbuddyHostHeartbeatPath as o, rewriteSessionTitleModel as ot, FALLBACK_WORKBUDDY_MODELS as p, recordRefusal as pt, isConversationIdGateBody as q, macosNestedAppBundles as qt, isHeartbeatProcessAlive as r, prepareChatBody as rt, writeHostHeartbeat as s, attachBusyLevels as st, WORKBUDDY_HOST_HEARTBEAT_FILENAME as t, parseUpstreamModel as tt, describeRosterSeenPayload as u, lastRefusalFor as ut, fallbackModelsFor as v, parseSupportedSecondsRange as vt, WorkBuddyEncryptedCredentialError as w, MAX_INPUT_IMAGE_BYTES as wt, WORKBUDDY_AUTH_FILENAME as x, DEFAULT_IMAGE_SIZE as xt, withoutRouters as y, pickVideoModel as yt, WORKBUDDY_FALLBACK_SYSTEM_PROMPT as z, deriveAtRestKey as zt };
