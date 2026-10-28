#!/usr/bin/env node
import { C as WorkBuddyCredentialStore, D as defaultDesktopAuthDirs, E as defaultDesktopAuthCandidates, I as workbuddyOwnAuthPath, Lt as WORKBUDDY_APP_EXECUTABLE_ENV, M as legacyWorkbuddyOwnAuthPath, S as WORKBUDDY_AUTH_FILE_ENV, Ut as findWorkbuddyAppExecutableWithSource, V as WorkBuddyUpstreamClient, Zt as hostPeersInfo, a as readHostHeartbeat, c as WORKBUDDY_CONNECT_VERSION, d as rosterSeenPath, f as piAiRuntimeInfo, m as FALLBACK_WORKBUDDY_MODELS_GLOBAL, o as workbuddyHostHeartbeatPath, p as FALLBACK_WORKBUDDY_MODELS, r as isHeartbeatProcessAlive, u as describeRosterSeenPayload } from "./host-heartbeat-guET27pw.js";
import { readFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
//#region src/bin.ts
/**
* Standalone status/diagnostics CLI for the dsh-connect-workbuddy bundle.
*
* 参考：corrinehu/dsh-workbuddy-connect（MIT，Copyright (c) 2026 Corrine Hu）
*   — 三个子命令（`doctor` / `status` / `logout`）、`--json` 输出、
*     `safeMessage` 脱敏、schemaVersion 字段、以及
*     「宿主心跳 + 桌面端凭据文件 + 登录态」三项联合诊断的结构，
*     均由该项目设计。
* 改动：凭据诊断由单文件扩展为「目录扫描 + 按账号分组」，
*     doctor 会列出发现的每个账号及其文件来源，便于确认多账号是否可用；
*     另补 desktopAuthDir 字段。双 provider 化后，doctor/status 按
*     区域（cn | global）分别报告各自的账号与登录态，logout 清除
*     所有插件自有凭据副本（两个区域文件 + 旧单文件）。
*
* @module dsh-connect-workbuddy/bin
*/
/**
* Version of the `doctor --json` document.
*
* 3 → 4: added `hostPeers` (issue #47). Consumers that switch on the version
* see the field appear rather than having to guess whether its absence means
* "old build" or "no peer".
*
* 4 → 5: added `rosterSeen`, so a first-sighting history that is corrupt or in
* a version this build cannot read is REPORTED rather than silently answered as
* "no new models".
*/
const JSON_SCHEMA_VERSION = 5;
/** Both regions, in reporting order. */
const REGIONS = ["cn", "global"];
/** Region labels for human output. */
const REGION_LABELS = {
	cn: "CN (domestic)",
	global: "Global"
};
/** Remove token-like strings from an unexpected diagnostic message. */
function safeMessage(error) {
	return (error instanceof Error ? error.message : String(error)).replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu, "[redacted token]").replace(/(\b(?:code|token|refresh_token|access_token)=)[^&\s]+/giu, "$1[redacted]");
}
function printHelp() {
	process.stdout.write([
		"Usage: dsh-connect-workbuddy <doctor|status|logout> [--json]",
		"",
		"  doctor   secret-free sign-in and environment diagnostics",
		"  status   per-region sign-in state, remaining credit, and host-bundle health",
		"  logout   remove every plugin-owned credential copy (the desktop app keeps its sign-in)",
		"  --json   emit one secret-free JSON document (doctor/status only)",
		""
	].join("\n"));
}
function printJson(value) {
	process.stdout.write(`${JSON.stringify(value)}\n`);
}
/** One region-scoped credential store (its own plugin-owned copy file). */
function makeStore(region) {
	const client = new WorkBuddyUpstreamClient();
	return new WorkBuddyCredentialStore({
		region,
		refresh: (credential) => client.refreshToken(credential)
	});
}
/** The region-unscoped store (reads every plugin-owned copy). */
function makeAnyStore() {
	const client = new WorkBuddyUpstreamClient();
	return new WorkBuddyCredentialStore({ refresh: (credential) => client.refreshToken(credential) });
}
/**
* Read one region's first-sighting history and describe its payload.
*
* Read-only: this CLI never writes history, so running `doctor` cannot change
* who counts as new. The point is that a corrupt file or one written by a newer
* build is REPORTED here — without this, both would surface as "no new models",
* which is a statement about this machine's catalogue and never a file.
*/
async function describeRosterSeen(region) {
	const path = rosterSeenPath(region);
	let raw = null;
	try {
		raw = JSON.parse(await readFile(path, "utf8"));
	} catch {
		raw = null;
	}
	const described = describeRosterSeenPayload(raw);
	if (described === null) return {
		path,
		present: raw !== null,
		readable: false
	};
	const version = raw["version"];
	return {
		path,
		present: true,
		readable: true,
		versionKnown: described.versionKnown,
		...typeof version === "number" ? { version } : {},
		ids: described.ids,
		fresh: described.fresh
	};
}
async function doctor(jsonOutput) {
	const anyStore = makeAnyStore();
	const desktopPresent = await anyStore.desktopFilePresent();
	const heartbeat = await readHostHeartbeat();
	const hostAlive = heartbeat !== void 0 && isHeartbeatProcessAlive(heartbeat);
	const discoveredApp = findWorkbuddyAppExecutableWithSource();
	const appExecutable = discoveredApp?.executable;
	const regionLists = await Promise.all(REGIONS.map(async (region) => ({
		region,
		accounts: await makeStore(region).accounts()
	})));
	const anySignedIn = regionLists.some(({ accounts }) => accounts.length > 0);
	/**
	* Which pi-ai copy the PROVIDER resolves, and hence which context shape its
	* api consumes. This is the #24/#26 gate made visible: a legacy (0.85)
	* resolution while the DSH host normalizes with 0.87 is exactly the mixed
	* generation the adapter has to bridge, and the only way to SEE it is to
	* report it. `resolvedLocally: false` is the normal state of a market
	* install probed outside the host — inside DSH the host supplies pi-ai
	* (0.2.0+ ships 0.87.1, i.e. the pass-through branch). Nothing here reads
	* or reports key material.
	*/
	const piAi = piAiRuntimeInfo();
	/**
	* Which atomic-write implementation this process would use (issue #47).
	*
	* The mirror of the `piAiRuntime` block below, for the same reason: the
	* plugin declares `@deepseek-ai/dsh-atomic-write` as a PEER, so inside a
	* booted host the host's copy is borrowed, while under `dsh plugin …
	* exec` the child resolves with stock Node rules and the peer is absent. A
	* missing peer used to be a load-time crash; it is now reported here so a
	* user can tell the two states apart without reading a stack trace.
	*/
	const hostPeers = await hostPeersInfo();
	const rosterSeen = await Promise.all(REGIONS.map(async (region) => ({
		region,
		summary: await describeRosterSeen(region)
	})));
	const report = {
		schemaVersion: JSON_SCHEMA_VERSION,
		package: "dsh-connect-workbuddy",
		version: WORKBUDDY_CONNECT_VERSION,
		node: process.version,
		piAiRuntime: {
			generation: piAi.generation,
			version: piAi.version ?? (piAi.resolvedLocally ? "(unreadable)" : "(host-provided)"),
			resolvedFrom: piAi.resolvedFrom ?? "(host-provided; not resolvable outside DSH)",
			resolvedLocally: piAi.resolvedLocally,
			adapterBehaviour: piAi.generation === "legacy" ? "folds 0.87 transcripts (system text + tool state) into the 0.85 context shape" : piAi.resolvedLocally ? "passes provider contexts through unchanged" : "passes provider contexts through unchanged (pi-ai comes from the DSH host; 0.2.0+ ships 0.87.1)"
		},
		hostPeers: {
			atomicWrite: hostPeers.atomicWrite,
			behaviour: hostPeers.atomicWrite === "host" ? "using @deepseek-ai/dsh-atomic-write from the DSH host" : "using the built-in copy: the host peer did not resolve here, which is the normal state outside a booted DSH (e.g. `dsh plugin … exec`)"
		},
		desktopAuthFile: {
			path: anyStore.desktopAuthPath() ?? "(no platform default; set WORKBUDDY_AUTH_FILE)",
			dir: defaultDesktopAuthDirs()[0] ?? "(no platform default)",
			candidates: defaultDesktopAuthCandidates(),
			present: desktopPresent
		},
		/**
		* Whether the encrypted-credential path is available. The desktop app
		* encrypts token fields on Windows builds; opening them needs that same
		* app, so an install location is exactly what this records. No key
		* material is read or reported here.
		*/
		atRestDecryption: {
			appExecutable: appExecutable ?? `(not found; set WORKBUDDY_APP_EXECUTABLE)`,
			/**
			* Where the path came from. `registry` means the app is installed outside
			* the default layout and the Windows uninstall registration found it; the
			* absence of this field (older reports) is why the hint below can now name
			* the mechanism instead of telling every user to set the env var.
			*/
			appExecutableSource: discoveredApp?.source,
			available: appExecutable !== void 0
		},
		ownAuthFiles: {
			cn: workbuddyOwnAuthPath("cn"),
			global: workbuddyOwnAuthPath("global"),
			legacy: legacyWorkbuddyOwnAuthPath()
		},
		hostHeartbeat: {
			path: workbuddyHostHeartbeatPath(),
			present: heartbeat !== void 0,
			...heartbeat === void 0 ? {} : {
				registeredAt: heartbeat.registeredAt,
				pid: heartbeat.pid
			},
			processAlive: hostAlive
		},
		regions: Object.fromEntries(regionLists.map(({ region, accounts }) => [region, accounts.map((account) => ({
			id: account.id,
			accountName: account.accountName,
			domain: account.domain === "" ? void 0 : account.domain,
			source: account.source,
			selected: account.selected,
			tokenExpiresAt: new Date(account.tokenExpiresAtMs).toISOString()
		}))])),
		fallbackModels: {
			cn: FALLBACK_WORKBUDDY_MODELS.length,
			global: FALLBACK_WORKBUDDY_MODELS_GLOBAL.length
		},
		rosterSeen: Object.fromEntries(rosterSeen.map(({ region, summary }) => [region, summary])),
		hints: [
			...anySignedIn ? [] : ["Sign in once in the WorkBuddy desktop app (either region), then run status again."],
			...desktopPresent ? [] : [`No WorkBuddy desktop auth file at the expected path; set ${WORKBUDDY_AUTH_FILE_ENV} if it lives elsewhere.`],
			...appExecutable === void 0 ? [`The WorkBuddy desktop app was not found, so encrypted credential fields cannot be opened. On Windows the install registration was already checked, so the app is either not installed or its uninstall entry is missing; set ${WORKBUDDY_APP_EXECUTABLE_ENV} to its executable if it is installed elsewhere.`] : [],
			...hostAlive ? [] : ["Host bundle not running in this DSH profile (or the process exited). The browser card and providers are unavailable until DSH starts the plugin."],
			...piAi.generation === "legacy" && piAi.resolvedLocally ? [`This plugin resolves pi-ai ${piAi.version ?? "(unreadable version)"} (the 0.85 context shape) while DSH 0.2.0+ hosts normalize with 0.87; the adapter bridges that gap, but if tools still misbehave, remove any nested pi-ai copy so the plugin resolves the host's.`] : [],
			...rosterSeen.flatMap(({ region, summary }) => {
				if (!summary.readable) return summary.present ? [`${REGION_LABELS[region]} first-sighting history is present but unreadable (${summary.path}); remove it to reseed on the next reconcile.`] : [];
				if (summary.versionKnown === false) return [`${REGION_LABELS[region]} first-sighting history is version ${summary.version === void 0 ? "unknown" : summary.version}, which this build cannot read (${summary.path}); it is answered as empty, so the pill shows no new-model marker.`];
				return [];
			})
		]
	};
	if (jsonOutput) printJson(report);
	else process.stdout.write([
		`WorkBuddy Connect ${WORKBUDDY_CONNECT_VERSION} on ${process.version}`,
		...piAi.resolvedLocally ? [`pi-ai runtime: ${piAi.generation}${piAi.version === void 0 ? "" : ` ${piAi.version}`} (${piAi.resolvedFrom}) — ${report.piAiRuntime.adapterBehaviour}`] : [`pi-ai runtime: ${piAi.generation}, host-provided (no local copy; DSH 0.2.0+ ships 0.87.1) — passes provider contexts through unchanged`],
		`Atomic writes: ${hostPeers.atomicWrite === "host" ? "host-provided (@deepseek-ai/dsh-atomic-write)" : "built-in copy (host peer not resolvable here; normal outside a booted DSH)"}`,
		`Desktop auth file: ${report.desktopAuthFile.present ? "present" : "missing"} (${report.desktopAuthFile.path})`,
		`Encrypted-credential support: ${report.atRestDecryption.available ? "available" : "unavailable"} (${report.atRestDecryption.appExecutable}${report.atRestDecryption.appExecutableSource === void 0 ? "" : `, via ${report.atRestDecryption.appExecutableSource}`})`,
		`Host bundle: ${hostAlive ? `running (pid ${heartbeat.pid})` : heartbeat !== void 0 ? "stale heartbeat (process exited)" : "not started"}`,
		...regionLists.flatMap(({ region, accounts }) => [`${REGION_LABELS[region]} accounts: ${accounts.length} (own copy ${workbuddyOwnAuthPath(region)})`, ...accounts.map((account) => `  - ${account.accountName === "" ? "(unnamed)" : account.accountName} (${account.id})${account.selected ? " [selected]" : ""} expires ${new Date(account.tokenExpiresAtMs).toISOString()}`)]),
		`Static fallback models: CN ${report.fallbackModels.cn}, Global ${report.fallbackModels.global}`,
		...REGIONS.map((region) => {
			const summary = report.rosterSeen[region];
			if (summary === void 0) return `New-model history (${REGION_LABELS[region]}): not available`;
			if (!summary.readable) return `New-model history (${REGION_LABELS[region]}): ${summary.present ? "unreadable" : "not started"} (${summary.path})`;
			if (summary.versionKnown === false) return `New-model history (${REGION_LABELS[region]}): version ${summary.version === void 0 ? "unknown" : summary.version} not readable (${summary.path})`;
			return `New-model history (${REGION_LABELS[region]}): ${summary.ids ?? 0} recorded, ${summary.fresh ?? 0} new`;
		}),
		...report.hints.map((hint) => `Hint: ${hint}`),
		""
	].join("\n"));
	return anySignedIn && desktopPresent ? 0 : 1;
}
/** One region's sign-in and credit summary. */
async function regionStatus(region) {
	const store = makeStore(region);
	const client = new WorkBuddyUpstreamClient();
	const authStatus = await store.status();
	const accounts = await store.accounts();
	const selected = accounts.find((account) => account.selected);
	const base = {
		region,
		status: authStatus.state,
		...authStatus.expiresAtMs === void 0 ? {} : { accessTokenExpires: new Date(authStatus.expiresAtMs).toISOString() },
		...authStatus.nickname === void 0 ? {} : { nickname: authStatus.nickname },
		...authStatus.domain === void 0 || authStatus.domain === "" ? {} : { domain: authStatus.domain },
		...selected === void 0 ? {} : {
			accountId: selected.id,
			accountName: selected.accountName
		},
		accountCount: accounts.length
	};
	if (authStatus.state !== "signed-in") return base;
	try {
		const credential = await store.resolve();
		return {
			...base,
			credits: (await client.fetchCredits(credential)).total
		};
	} catch (error) {
		return {
			...base,
			credits: 0,
			creditsError: safeMessage(error)
		};
	}
}
async function status(jsonOutput) {
	const heartbeat = await readHostHeartbeat();
	const hostAlive = heartbeat !== void 0 && isHeartbeatProcessAlive(heartbeat);
	const hostState = hostAlive ? "running" : heartbeat !== void 0 ? "stale" : "not-started";
	const fragments = await Promise.all(REGIONS.map((region) => regionStatus(region)));
	const cn = fragments.find((fragment) => fragment.region === "cn");
	if (jsonOutput) {
		printJson({
			schemaVersion: JSON_SCHEMA_VERSION,
			package: "dsh-connect-workbuddy",
			version: WORKBUDDY_CONNECT_VERSION,
			status: cn?.status === "signed-in" ? "signed-in" : "signed-out",
			...cn?.status === "signed-in" ? {
				...cn.accessTokenExpires === void 0 ? {} : { accessTokenExpires: cn.accessTokenExpires },
				...cn.nickname === void 0 ? {} : { nickname: cn.nickname },
				...cn.domain === void 0 ? {} : { domain: cn.domain },
				...cn.accountId === void 0 ? {} : {
					accountId: cn.accountId,
					accountName: cn.accountName
				}
			} : {},
			regions: Object.fromEntries(fragments.map((fragment) => [fragment.region, fragment])),
			hostBundle: hostState
		});
		return fragments.some((fragment) => fragment.status === "signed-in") ? 0 : 1;
	}
	process.stdout.write([
		...fragments.flatMap((fragment) => [
			`${REGION_LABELS[fragment.region]}: ${fragment.status === "signed-in" ? `signed in${fragment.accountName === void 0 ? "" : ` as ${fragment.accountName}`}` : "signed out"}`,
			...fragment.status === "signed-in" && fragment.accessTokenExpires !== void 0 ? [`  Access token expires ${fragment.accessTokenExpires} (refresh is automatic)`] : [],
			`  Local accounts: ${fragment.accountCount}`,
			...fragment.creditsError !== void 0 ? [`  Remaining credit: unavailable (${fragment.creditsError})`] : fragment.credits !== void 0 ? [`  Remaining credit: ${fragment.credits}`] : []
		]),
		`Host bundle: ${hostAlive ? `running (pid ${heartbeat.pid})` : hostState === "stale" ? "stale heartbeat (DSH process exited)" : "not started in this profile"}`,
		"Client card: load failures are logged to the browser console only; the host providers are unaffected.",
		""
	].join("\n"));
	return fragments.some((fragment) => fragment.status === "signed-in") ? 0 : 1;
}
/** Execute one boot-free command. */
async function run(argv) {
	if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
		printHelp();
		return 0;
	}
	const [rawAction, ...flags] = argv;
	if (![
		"doctor",
		"logout",
		"status"
	].includes(rawAction)) {
		process.stderr.write(`dsh-connect-workbuddy: expected doctor, logout, or status; got ${JSON.stringify(rawAction)}\n`);
		return 1;
	}
	const action = rawAction;
	const jsonOutput = flags.includes("--json");
	if (flags.filter((flag) => flag !== "--json").length > 0 || jsonOutput && action === "logout") {
		process.stderr.write(`dsh-connect-workbuddy: invalid options for ${action}: ${flags.join(" ")}\n`);
		return 1;
	}
	try {
		switch (action) {
			case "doctor": return await doctor(jsonOutput);
			case "status": return await status(jsonOutput);
			case "logout":
				await makeAnyStore().logout();
				process.stdout.write(`WorkBuddy Connect: removed the plugin-owned credential copies (${workbuddyOwnAuthPath("cn")}, ${workbuddyOwnAuthPath("global")}, ${legacyWorkbuddyOwnAuthPath()}); the desktop app's sign-in is untouched\n`);
				return 0;
		}
	} catch (error) {
		process.stderr.write(`dsh-connect-workbuddy: ${action} failed: ${safeMessage(error)}\n`);
		return 1;
	}
}
if (process.argv[1] !== void 0 && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) process.exitCode = await run(process.argv.slice(2));
//#endregion
export { run };
