#!/usr/bin/env node
import { $ as DEFAULT_WIRE_PROFILE, Cn as hostPeersInfo, F as WorkBuddyCredentialStore, J as workbuddyOwnAuthPath, N as WORKBUDDY_AUTH_FILE_ENV, P as WORKBUDDY_VAULT_DIRNAME, R as defaultDesktopAuthCandidates, T as FALLBACK_WORKBUDDY_MODELS_GLOBAL, W as legacyWorkbuddyOwnAuthPath, X as APP_VERSION, Y as workbuddyVaultDir, a as readHostHeartbeat, an as deriveDeviceId, b as readDeviceSettings, c as WORKBUDDY_CONNECT_VERSION, cn as protectCredentialDirectory, d as rosterSeenPath, f as WORKBUDDY_CN_BASE_ENV, g as createTuringSdk, hn as findWorkbuddyAppExecutableWithSource, in as readDeviceSalt, ln as WORKBUDDY_APP_EXECUTABLE_ENV, m as piAiRuntimeInfo, nn as readDeviceTokenFile, nt as WorkBuddyUpstreamClient, o as workbuddyHostHeartbeatPath, ot as describeRequestHeaderNames, p as resolveCnGateway, r as isHeartbeatProcessAlive, rn as ensureDeviceSalt, sn as inspectCredentialDirectory, tn as WORKBUDDY_DEVICE_TOKEN_FILE_ENV, u as describeRosterSeenPayload, w as FALLBACK_WORKBUDDY_MODELS, wn as resolveDshHome, z as defaultDesktopAuthDirs } from "./host-heartbeat-Dq3ITRhF.js";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
//#region src/device-state.ts
/**
* 设备身份的**只读取证视图**（审计报告 P0，P1 起同时是"派生档会发什么"的唯一答案）。
*
* 这一层不注入头、不写盘、不发请求，只回答两个问题：
*
*   1. **现在**有没有设备身份真的上了线？——答案不是写死的文案，而是把请求路径
*      上同一批构造器跑出来的头名集合过滤一遍（{@link describeRequestHeaderNames}）。
*      于是它随代码自动变化：P1 之前是空数组，P1 之后是 `X-Machine-ID` /
*      `X-Session-ID`，而没有任何地方需要改两次。
*   2. **派生档**会给这台机器的每个账号发什么？——同一个盐算出 machine/session
*      一对 id，并统计"N 个账号 → 几个不同设备"。第二个数字是审计 §5.4 的核心
*      问题：池子里的号是共用一台设备（易被聚成一群），还是各自一台（隔离）。
*
* ## 为什么盐由调用方传进来
*
* P0 时这个模块自己 `ensureDeviceSalt()`，因为那时它是唯一的调用者。P1 之后
* `doctor` 还要把同一个盐交给 {@link describeRequestHeaderNames} 去渲染完整的
* 头名清单——两处各自读一次盐，就可能各自读到不同的状态（一次读到 absent、
* 一次读到 ok），于是报告会在同一屏里自相矛盾。盐是调用方的事实，这里只做算术。
*
* 两者都不含凭据、不含盐本身。
*
* @module dsh-connect-workbuddy/device-state
*/
/**
* 承载设备身份的**全部**头名。P2/P3 加 `X-Device-Token` 的读取时，这个常量不变
* ——它描述的是"哪些头算设备身份"，不是"我们发了哪些"。
*/
const WORKBUDDY_DEVICE_HEADER_NAMES = [
	"X-Device-Token",
	"X-Machine-ID",
	"X-Session-ID"
];
/**
* 把已经读到的盐与本地账号，组合成 `doctor` 要的那份报告。
*
* `credentials` 只用来取 `uid`：报告里不出现账号名、账号 id 或任何令牌。重复的
* uid 会被折叠（同一个号的两个历史凭据文件不该被算成两台设备）。
*
* 纯函数（无 IO、无时钟），所以测试不需要临时目录，也不会因为读写顺序不同而
* 得到两种答案。
*/
function describeDeviceState(credentials, saltReadout, tokenReadout, real) {
	const tier = real?.tier ?? "virtual";
	/**
	* 退回是否发生：真实值档 + 没有真 token + 开关开。
	*
	* 与 `upstream.ts` 的 `wireIdentity` 用**同一条判据**。两处各写一遍是这次改动
	* 里唯一无法消除的重复（那个函数在请求路径上，不能 import 这个纯函数模块的
	* 调用方；反过来会让 `device-state` 变成请求路径的依赖）。因此这条判据被写得
	* 尽量小，且两边各有一条用例钉住同一种组合。
	*/
	const fellBack = tier === "real" && real?.value === void 0 && real?.fallbackToVirtual === true;
	const tierSent = fellBack ? "virtual" : tier;
	const salt = {
		path: saltReadout.path,
		state: saltReadout.state,
		..."reason" in saltReadout ? { reason: saltReadout.reason } : {}
	};
	const token = tokenReadout === void 0 ? void 0 : {
		path: tokenReadout.path,
		state: tokenReadout.state,
		...tokenReadout.ageMs === void 0 ? {} : { ageMs: tokenReadout.ageMs },
		..."reason" in tokenReadout ? { reason: tokenReadout.reason } : {}
	};
	const identity = tierSent === "real" ? {
		deviceTier: "real",
		...real?.value === void 0 ? {} : { deviceReal: real.value }
	} : {
		...saltReadout.state === "ok" ? { deviceSalt: saltReadout.salt } : {},
		...tokenReadout?.state === "ok" ? { deviceToken: tokenReadout.token } : {}
	};
	const probe = credentials[0];
	const onWire = probe === void 0 ? [] : describeRequestHeaderNames("chat", probe, identity).filter((name) => WORKBUDDY_DEVICE_HEADER_NAMES.includes(name));
	const sdk = real === void 0 ? void 0 : {
		state: real.sdk.state,
		bundle: real.sdk.bundle,
		path: real.sdk.path,
		...real.sdk.reason === void 0 ? {} : { reason: real.sdk.reason },
		token: {
			state: real.token.state,
			length: real.token.length,
			...real.token.fetchedAtMs === void 0 ? {} : { ageMs: Date.now() - real.token.fetchedAtMs },
			...real.token.reason === void 0 ? {} : { reason: real.token.reason }
		}
	};
	const uids = [...new Set(credentials.map((credential) => credential.uid).filter((uid) => uid !== ""))];
	const base = {
		tier,
		...fellBack ? { tierSent } : {},
		...fellBack ? { fallbackToVirtual: true } : {},
		onWire,
		salt,
		...token === void 0 ? {} : { token },
		...sdk === void 0 ? {} : { sdk }
	};
	if (tierSent === "real") return base;
	if (uids.length === 0 || saltReadout.state !== "ok") return base;
	const machineIds = uids.map((uid) => deriveDeviceId(uid, "machine", saltReadout.salt));
	return {
		...base,
		derived: {
			accounts: uids.length,
			distinct: new Set(machineIds).size,
			sample: {
				machineId: machineIds[0],
				sessionId: deriveDeviceId(uids[0], "session", saltReadout.salt)
			}
		}
	};
}
//#endregion
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
*
* 5 → 6: added `credentialAcl` (issue #183). A store that could only ever ask
* for `mode: 0o600` looked identical to one that enforced it; the new block
* answers what the folder permissions actually ARE on this machine.
*
* 6 → 7: added `deviceIdentity` — which device headers are actually attached
* (nothing before P1, the derived `X-Machine-ID` / `X-Session-ID` pair from P1
* on) plus how many distinct virtual devices the pool would present. Added
* because "the plugin has no device identity" was a fact only a source reader
* could know; `doctor` is where it has to be visible
* (docs/DEVICE-IDENTITY-AUDIT.md).
*
* 7 → 8: added `deviceIdentity.token` (P2). The field is absent when this CLI did
* not inspect a token file at all — which is a different answer from "I looked
* and found none", so a consumer must be able to tell them apart rather than
* guess whether the absence means "old build" or "not configured".
*
* 8 → 9: added `deviceIdentity.tier` and `deviceIdentity.sdk` (P3). `tier` is
* required because the same `onWire` list now has two explanations: in the real
* tier it is one header and derived devices do not exist. Without it a consumer
* reading `onWire: ['X-Device-Token']` cannot tell "real tier, working" from
* "virtual tier with a file token".
*
* 9 → 10: `deviceIdentity.tierSent` / `deviceIdentity.fallbackToVirtual` (作者
* 意见 #2). Once the real tier may fall back to the virtual device, `tier` alone
* is no longer a description of the wire — it is the INTENT. Both fields appear
* only when they diverge, so a consumer that only knows version 9 keeps working
* for every machine that never turned the switch on, and a machine that did
* becomes legible instead of self-contradictory.
*/
const JSON_SCHEMA_VERSION = 10;
/** Both regions, in reporting order. */
const REGIONS = ["cn", "global"];
/**
* Set to `1` to have `doctor` print the header NAME list each request path
* would send. Names only — see the call site for why values are never printed.
*/
const HEADER_TRACE_ENV = "WORKBUDDY_HEADER_TRACE";
/** 毫秒 → `42s` / `3m` / `2h5m`，只用于人读的诊断。 */
function describeAge(ms) {
	const seconds = Math.max(0, Math.round(ms / 1e3));
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.round(seconds / 60);
	if (minutes < 120) return `${minutes}m`;
	return `${Math.floor(minutes / 60)}h${minutes % 60 === 0 ? "" : `${minutes % 60}m`}`;
}
/**
* The human form of the `deviceIdentity` block.
*
* Three lines on purpose: what is on the wire, whether an external token was
* inspected at all, and how many distinct virtual devices the pool would
* present. Collapsing them would let "3 accounts → 3 devices" read as "we send
* three devices".
*
* The first line names the tier because `doctor` runs outside the plugin and
* therefore cannot see the configured `wireProfile`: it renders the DEFAULT
* tier. A user who set `conservative` will see `balanced` here — stated rather
* than silently assumed, so the discrepancy is at least visible.
*/
function describeDeviceLines(device, accounts) {
	const onWire = device.onWire.length === 0 ? "none — no X-Device-Token / X-Machine-ID / X-Session-ID is attached" : device.onWire.join(", ");
	/**
	* 档位这一句要能读出**分岔**（作者意见 #2）。
	*
	* 退回生效时用户设的是 real、线上发的是 virtual。只印 `device.tier` 会让这一行
	* 与后头的头名清单互相打脸（"real values: X-Machine-ID, X-Session-ID" 读起来像
	* bug）。所以分岔时就把它明写出来，并说出为什么——退回是用户自己开的开关。
	*/
	const tierWords = device.tierSent === void 0 ? `${device.tier} values` : `${device.tier} requested, ${device.tierSent} values (fell back: no real device token)`;
	const head = `Device identity on the wire (${DEFAULT_WIRE_PROFILE} headers, ${tierWords}): ${onWire}`;
	const salt = `${device.salt.state}${device.salt.reason === void 0 ? "" : `: ${device.salt.reason}`} — ${device.salt.path}`;
	const derived = device.tierSent === "real" ? "Derived devices: not used in the real tier — every account shares this machine's real device" : accounts === 0 ? `Derived devices: no signed-in account to derive from; salt ${salt}` : device.derived === void 0 ? `Derived devices: unavailable; salt ${salt}` : `Derived devices: ${accounts} account(s) → ${device.derived.distinct} distinct, sample machine=${device.derived.sample.machineId} session=${device.derived.sample.sessionId}; salt ${salt}`;
	return [
		head,
		device.tierSent === "real" ? `Device token file: not consulted in the real tier (the SDK is the source there)` : device.token === void 0 ? `Device token: not inspected here — set ${WORKBUDDY_DEVICE_TOKEN_FILE_ENV} to the same file the plugin reads` : `Device token: ${device.token.state}${device.token.ageMs === void 0 ? "" : `, written ${describeAge(device.token.ageMs)} ago`}${device.token.reason === void 0 ? "" : ` (${device.token.reason})`} — ${device.token.path}`,
		...device.sdk === void 0 ? [] : [`Device SDK: ${device.sdk.state}${device.sdk.reason === void 0 ? "" : `: ${device.sdk.reason}`} (${device.sdk.bundle} — ${device.sdk.path === "" ? "no installed SDK found" : device.sdk.path}); token ${device.sdk.token.state}${device.sdk.token.length === 0 ? "" : ` (${device.sdk.token.length} chars)`}${device.sdk.token.ageMs === void 0 ? "" : `, fetched ${describeAge(device.sdk.token.ageMs)} ago`}${device.sdk.token.reason === void 0 ? "" : ` (${device.sdk.token.reason})`}`],
		derived
	];
}
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
/**
* The CN gateway override as the CLI can see it (issue #220).
*
* `doctor` runs in its own process and never loads the plugin's settings, so the
* card's field is invisible here. Without this, a user who fixed their network
* would run `doctor` and get a report measured against the gateway their network
* resets — a diagnostics tool lying about which host it probed.
*
* An invalid value is REPORTED and then ignored rather than silently dropped:
* `doctor` is where a user goes to find out why nothing works, so "your
* override was rejected because X" is exactly the answer they need.
*/
function cliCnBase() {
	const raw = (process.env["WORKBUDDY_CN_BASE"] ?? "").trim();
	if (raw === "") return "";
	const resolved = resolveCnGateway(raw);
	if (!resolved.ok) {
		process.stderr.write(`warning: ignoring ${WORKBUDDY_CN_BASE_ENV}="${raw}" — ${resolved.reason === "malformed" ? "not an absolute URL" : resolved.reason === "insecure" ? "only https is accepted" : "host is not one of the CN brands"}\n`);
		return "";
	}
	return resolved.overridden ? resolved.base : "";
}
/** One region-scoped credential store (its own plugin-owned copy file). */
function makeStore(region) {
	const client = new WorkBuddyUpstreamClient(void 0, {}, { cnBase: cliCnBase });
	return new WorkBuddyCredentialStore({
		region,
		refresh: (credential) => client.refreshToken(credential)
	});
}
/** The region-unscoped store (reads every plugin-owned copy). */
function makeAnyStore() {
	const client = new WorkBuddyUpstreamClient(void 0, {}, { cnBase: cliCnBase });
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
	/**
	* Per-region folder permissions of the plaintext credential vault (issue #183).
	*
	* Computed BEFORE the report object because both the report AND its `hints`
	* read it, and a hint that reached back into the half-built report would be a
	* use-before-declaration. It also runs the repair, so `doctor` fixes an
	* exposed directory rather than only describing it.
	*/
	const credentialAcl = await Promise.all(REGIONS.map(async (region) => {
		const directory = workbuddyVaultDir(region);
		const rootOutcome = await protectCredentialDirectory(dirname(directory));
		const outcome = await protectCredentialDirectory(directory);
		const acl = await inspectCredentialDirectory(directory);
		const skipped = [rootOutcome, outcome].find((candidate) => candidate.state === "skipped");
		const failed = [outcome, rootOutcome].find((candidate) => candidate.state === "failed");
		return [region, {
			directory: acl.directory,
			state: acl.state,
			...acl.weak === void 0 ? {} : { unexpected: acl.weak },
			...acl.reason === void 0 ? {} : { reason: acl.reason },
			...failed !== void 0 && failed.state === "failed" ? { protectError: failed.reason } : {},
			...skipped !== void 0 && skipped.state === "skipped" ? { protectSkipped: skipped.reason } : {}
		}];
	}));
	/** Indexed by region so the human output cannot silently skip a missing one. */
	const credentialAclByRegion = {
		cn: credentialAcl.find(([region]) => region === "cn")[1],
		global: credentialAcl.find(([region]) => region === "global")[1]
	};
	/**
	* 设备身份取证（审计 `docs/DEVICE-IDENTITY-AUDIT.md` §4 的 D1 / §5.4 的隔离性）。
	*
	* 只读地算出两件事：现在**有没有**设备头上了线，以及派生档会给池子里的每个号
	* 算出什么。唯一可能的写入是首次生成 `$DSH_HOME/.workbuddy-device.json`——
	* 没有盐就算不出"这个池子会不会塌成一台设备"，而这个答案离线推不出来。
	* 只在确有账号时生成：一台没登录的机器不该留下设备身份。
	*
	* 盐在这里读**一次**，同一份读数同时喂给报告和下面的头名清单。两处各读一次
	* 就可能读到两种状态（一次 absent、一次 ok），于是同一屏里自相矛盾。
	*/
	const deviceCredentials = (await Promise.all((await anyStore.accounts()).map(async (account) => anyStore.credentialFor(account.id)))).filter((credential) => credential !== void 0);
	const deviceSalt = deviceCredentials.length === 0 ? await readDeviceSalt() : await ensureDeviceSalt();
	/**
	* 外部设备 token（P2）。
	*
	* `doctor` 读不到插件配置，只能读环境变量——所以路径只有一种写法时两侧才一致
	* （见 `WORKBUDDY_DEVICE_TOKEN_FILE_ENV` 的注释）。没设就**不去猜**：报告里
	* 明确写"这里没查"，而不是假装"没有 token"。
	*/
	const deviceTokenFile = (process.env["WORKBUDDY_DEVICE_TOKEN_FILE"] ?? "").trim();
	const deviceToken = deviceTokenFile === "" ? void 0 : await readDeviceTokenFile(deviceTokenFile);
	/**
	* 真实值档（P3）。
	*
	* 档位来自磁盘上的设备设置，不是猜的：同一台机器上插件与 `doctor` 读的是同一份
	* 文件。`probe` 只起一个 6 ms 的子进程读 `isSupported`，**不发网络请求**；只有
	* 真的处于真实值档时才去取一枚 token——那正是"SDK 现在能不能工作"的答案，
	* 而它恰好是排障时最想知道的。
	*/
	const deviceSettings = await readDeviceSettings();
	const deviceTier = deviceSettings.mode;
	const turing = createTuringSdk({
		productVersion: APP_VERSION,
		dirSource: async () => (await readDeviceSettings()).sdkDir
	});
	const turingInfo = await turing.info();
	const turingToken = deviceTier === "real" ? await turing.tokens.current() : void 0;
	const device = describeDeviceState(deviceCredentials, deviceSalt, deviceToken, {
		tier: deviceTier,
		sdk: turingInfo,
		token: turing.tokens.readout(),
		...turingToken === void 0 ? {} : { value: turingToken },
		fallbackToVirtual: deviceSettings.sdkFallbackToVirtual
	});
	const wireIdentity = deviceTier === "real" ? {
		deviceTier: "real",
		...turingToken === void 0 ? {} : { deviceReal: turingToken }
	} : {
		...deviceSalt.state === "ok" ? { deviceSalt: deviceSalt.salt } : {},
		...deviceToken?.state === "ok" ? { deviceToken: deviceToken.token } : {}
	};
	/**
	* `WORKBUDDY_HEADER_TRACE=1` 时的头名清单。
	*
	* 只打**名字**，从不打值：这份输出是要贴进 issue 的，而头里混着令牌、会话 id
	* 与派生设备 id。chat 与 billing 成对出现，是因为它们同 token 同分钟却曾经声称
	* 两种客户端（审计 §1.3 的 D2）——能被看见才谈得上验证"现在统一了"。
	*/
	const probeCredential = deviceCredentials[0];
	const tracedHeaders = process.env[HEADER_TRACE_ENV] === "1" && probeCredential !== void 0 ? ["chat", "billing"].map((kind) => ({
		kind,
		names: describeRequestHeaderNames(kind, probeCredential, wireIdentity)
	})) : void 0;
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
		/**
		* Whether the plaintext credential vault is actually restricted (issue #183).
		*
		* The `mode: 0o600` the writer passes is a POSIX concept; on Windows the
		* DACL decides. Reporting it here is the difference between "we asked for
		* 0600" and "the token file is readable only by its owner" — the reporter
		* found out it was the former while believing the latter. Per region,
		* because the two directories are hardened independently.
		*
		* On POSIX every entry reads `not-windows` and no hint is emitted: `mode`
		* carries the same intent there, and warning every macOS user about a
		* Windows-only measure would be noise.
		*/
		credentialAcl: {
			vaultDirectory: join(resolveDshHome(), WORKBUDDY_VAULT_DIRNAME),
			regions: Object.fromEntries(credentialAcl)
		},
		/**
		* 设备身份：现在发了什么（`onWire`，由真实构造器算出而非写死）与派生档会发
		* 什么。见 `docs/DEVICE-IDENTITY-AUDIT.md`。盐值本身永不出现，只报状态与路径。
		*/
		deviceIdentity: {
			tier: device.tier,
			...device.tierSent === void 0 ? {} : { tierSent: device.tierSent },
			...device.fallbackToVirtual === void 0 ? {} : { fallbackToVirtual: device.fallbackToVirtual },
			onWire: device.onWire,
			salt: device.salt,
			...device.token === void 0 ? {} : { token: device.token },
			...device.sdk === void 0 ? {} : { sdk: device.sdk },
			...device.derived === void 0 ? {} : { derived: device.derived },
			...tracedHeaders === void 0 ? {} : { requestHeaders: Object.fromEntries(tracedHeaders.map(({ kind, names }) => [kind, names])) }
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
			}),
			...credentialAcl.flatMap(([region, entry]) => {
				if (entry.state !== "exposed") return [];
				return [`The ${region} credential vault holds PLAINTEXT tokens but its folder permissions do not restrict them${entry.unexpected === void 0 ? "" : ` (readable by ${entry.unexpected.join(", ")})`}: ${entry.directory}. Re-run doctor to retry the repair, or fix it by hand with: icacls "${entry.directory}" /inheritance:r /grant:r "%USERNAME%:(OI)(CI)(F)" /grant:r "*S-1-5-18:(OI)(CI)(F)" /grant:r "*S-1-5-32-544:(OI)(CI)(F)"`];
			}),
			...credentialAcl.flatMap(([region, entry]) => {
				if (entry.state !== "failed" && entry.state !== "unverified") return [];
				return [`The ${region} credential vault ACL could NOT be verified or repaired this run${entry.reason === void 0 ? "" : ` Reason: ${entry.reason}`}: ${entry.directory}. If the directory is suddenly unreadable (EPERM on stat/readdir), its owner is probably not your user account — recover with (elevated): takeown /F "${entry.directory}" /R /D Y && icacls "${entry.directory}" /reset /T, then re-run doctor.`];
			}),
			...credentialAcl.flatMap(([, entry]) => entry.protectSkipped === void 0 ? [] : [entry.protectSkipped])
		]
	};
	if (jsonOutput) printJson(report);
	else process.stdout.write([
		`WorkBuddy Connect ${WORKBUDDY_CONNECT_VERSION} on ${process.version}`,
		...piAi.resolvedLocally ? [`pi-ai runtime: ${piAi.generation}${piAi.version === void 0 ? "" : ` ${piAi.version}`} (${piAi.resolvedFrom}) — ${report.piAiRuntime.adapterBehaviour}`] : [`pi-ai runtime: ${piAi.generation}, host-provided (no local copy; DSH 0.2.0+ ships 0.87.1) — passes provider contexts through unchanged`],
		`Atomic writes: ${hostPeers.atomicWrite === "host" ? "host-provided (@deepseek-ai/dsh-atomic-write)" : "built-in copy (host peer not resolvable here; normal outside a booted DSH)"}`,
		`Desktop auth file: ${report.desktopAuthFile.present ? "present" : "missing"} (${report.desktopAuthFile.path})`,
		`Encrypted-credential support: ${report.atRestDecryption.available ? "available" : "unavailable"} (${report.atRestDecryption.appExecutable}${report.atRestDecryption.appExecutableSource === void 0 ? "" : `, via ${report.atRestDecryption.appExecutableSource}`})`,
		...describeDeviceLines(device, deviceCredentials.length),
		...tracedHeaders === void 0 ? [] : tracedHeaders.map(({ kind, names }) => `Headers (${kind}, ${names.length}): ${names.join(", ")}`),
		`Host bundle: ${hostAlive ? `running (pid ${heartbeat.pid})` : heartbeat !== void 0 ? "stale heartbeat (process exited)" : "not started"}`,
		...regionLists.flatMap(({ region, accounts }) => [`${REGION_LABELS[region]} accounts: ${accounts.length} (own copy ${workbuddyOwnAuthPath(region)})`, ...accounts.map((account) => `  - ${account.accountName === "" ? "(unnamed)" : account.accountName} (${account.id})${account.selected ? " [selected]" : ""} expires ${new Date(account.tokenExpiresAtMs).toISOString()}`)]),
		`Static fallback models: CN ${report.fallbackModels.cn}, Global ${report.fallbackModels.global}`,
		...REGIONS.map((region) => {
			const entry = credentialAclByRegion[region];
			const detail = entry.state === "protected" ? "owner / SYSTEM / Administrators only" : entry.state === "not-windows" ? "POSIX mode 0600 applies" : entry.state === "exposed" ? `EXPOSED${entry.unexpected === void 0 ? "" : ` to ${entry.unexpected.join(", ")}`}` : "unverified";
			return `Credential vault ACL (${REGION_LABELS[region]}): ${entry.state} — ${detail} (${entry.directory})`;
		}),
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
	const client = new WorkBuddyUpstreamClient(void 0, {}, { cnBase: cliCnBase });
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
