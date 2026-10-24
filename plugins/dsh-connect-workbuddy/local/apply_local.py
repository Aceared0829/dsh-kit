"""Re-apply NingHong's local system-prompt customization onto upstream 5.7.0.

Upstream 5.7.0 handles channel fingerprints by PREPENDING an English neutral
head ("You are a helpful assistant.") to any scanned message whose opening
matches a measured fingerprint, and only scans openings.

The local (zh) customization instead:
  * replaces the fingerprinted line IN PLACE with our own Chinese text
    (the Web GUI paragraph becomes WEB_GUI_PROMPT_ZH, every other identity
    line becomes WORKBUDDY_FALLBACK_SYSTEM_PROMPT),
  * matches per LINE (not only at the opening), because the gateway was
    measured to reject the English Web-GUI paragraph mid-content too,
  * and keeps the plugin's own short placeholder as the Chinese line.

Everything else (scansOpening's system+assistant coverage, array text parts,
forceNeutralHead, perturbChannelFingerprints and the retry ladder) stays
upstream 5.7.0.
"""
import io
import sys

TARGET = sys.argv[1]

FALLBACK_OLD = 'const WORKBUDDY_FALLBACK_SYSTEM_PROMPT = "You are a helpful assistant.";'

FALLBACK_NEW = '''const WORKBUDDY_FALLBACK_SYSTEM_PROMPT = "你乃AI辅助软件也。";
const WEB_GUI_PROMPT_ZH = "你正通过 DeepSeek Harness 网页界面与用户对话，界面地址以运行时上下文给出的为准。用户若说「这个页面」「这个界面」或「这个应用」且没有点名别的目标，指的就是这个界面。浏览器不会附带 DOM、路由或截图。客户端插件的热更新接收器是开着的，但只有同一检出里同时在跑 `pnpm run dev:web` 重建包时，插件改动才会不刷新页面就生效；承诺自动更新前先确认那个监视进程在跑。其余改动（apps/web 外壳和普通包）必须重新构建对应的 Web 产物，刷新页面后再核对这个地址。另开一个服务器不会更新当前界面。apps/web 的 Vite 入口只构建外壳，不是独立应用，因为只有 dsh web 会注入 window.__DSH_BOOT__。除非用户要求，不要再启动替代服务器；如果需要，用托管后台任务，并核对它的准确地址。";'''

LIST_OLD = '''const UNAPPROVED_CHANNEL_OPENINGS = ["you are an ai agent powered by deepseek harness", "you are claude code, anthropic's official cli for claude"];'''

LIST_NEW = '''const UNAPPROVED_CHANNEL_OPENINGS = [
	{ prefix: "you are interacting with the user through the deepseek harness", replacement: WEB_GUI_PROMPT_ZH },
	{ prefix: "you are an ai agent powered by deepseek harness", replacement: WORKBUDDY_FALLBACK_SYSTEM_PROMPT },
	{ prefix: "you are claude code, anthropic's official cli for claude", replacement: WORKBUDDY_FALLBACK_SYSTEM_PROMPT },
	{ prefix: "you are a helpful assistant", replacement: WORKBUDDY_FALLBACK_SYSTEM_PROMPT }
];'''

PRED_OLD = '''function isUnapprovedChannelOpening(text) {
	const opening = text.replace(/^\\s+/u, "").toLowerCase();
	return UNAPPROVED_CHANNEL_OPENINGS.some((prefix) => opening.startsWith(prefix));
}'''

PRED_NEW = '''function unapprovedChannelOpeningOf(text) {
	const opening = text.replace(/^\\s+/u, "").toLowerCase();
	return UNAPPROVED_CHANNEL_OPENINGS.find((item) => opening.startsWith(item.prefix));
}
function isUnapprovedChannelOpening(text) {
	return unapprovedChannelOpeningOf(text) !== void 0;
}'''

NEUTRALIZE_OLD = '''function neutralizeChannelFingerprints(obj) {
	const messages = obj["messages"];
	if (!Array.isArray(messages)) return;
	for (const value of messages) {
		if (typeof value !== "object" || value === null || Array.isArray(value)) continue;
		const message = value;
		if (!scansOpening(message["role"])) continue;
		const content = message["content"];
		if (typeof content === "string") {
			if (!isUnapprovedChannelOpening(content)) continue;
			message["content"] = `${WORKBUDDY_FALLBACK_SYSTEM_PROMPT}\\n\\n${content}`;
			continue;
		}
		if (!Array.isArray(content)) continue;
		for (const part of content) {
			if (typeof part !== "object" || part === null || Array.isArray(part)) continue;
			const record = part;
			const type = record["type"];
			if (typeof type !== "string" || type.trim().toLowerCase() !== "text") continue;
			const text = record["text"];
			if (typeof text !== "string" || !isUnapprovedChannelOpening(text)) continue;
			record["text"] = `${WORKBUDDY_FALLBACK_SYSTEM_PROMPT}\\n\\n${text}`;
		}
	}
}'''

NEUTRALIZE_NEW = '''function neutralizeText(text) {
	const lines = text.split("\\n");
	let changed = false;
	for (let index = 0; index < lines.length; index++) {
		const opening = lines[index].replace(/^\\s+/u, "").toLowerCase();
		if (opening === "") continue;
		const hit = unapprovedChannelOpeningOf(opening);
		if (hit === void 0) continue;
		lines[index] = hit.replacement;
		changed = true;
	}
	return changed ? lines.join("\\n") : void 0;
}
function neutralizeChannelFingerprints(obj) {
	const messages = obj["messages"];
	if (!Array.isArray(messages)) return;
	for (const value of messages) {
		if (typeof value !== "object" || value === null || Array.isArray(value)) continue;
		const message = value;
		if (!scansOpening(message["role"])) continue;
		const content = message["content"];
		if (typeof content === "string") {
			const next = neutralizeText(content);
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
			const next = neutralizeText(text);
			if (next !== void 0) record["text"] = next;
		}
	}
}'''

with io.open(TARGET, encoding="utf-8") as fh:
    source = fh.read()

for label, old, new in [
    ("FALLBACK", FALLBACK_OLD, FALLBACK_NEW),
    ("OPENINGS", LIST_OLD, LIST_NEW),
    ("PREDICATE", PRED_OLD, PRED_NEW),
    ("NEUTRALIZE", NEUTRALIZE_OLD, NEUTRALIZE_NEW),
]:
    count = source.count(old)
    if count != 1:
        raise SystemExit("anchor %s matched %d times" % (label, count))
    source = source.replace(old, new)

with io.open(TARGET, "w", encoding="utf-8", newline="\n") as fh:
    fh.write(source)

print("patched", TARGET)
