# -*- coding: utf-8 -*-
"""Re-apply the local (zh) system-prompt customization onto upstream >= 5.8.1.

Upstream keeps every channel-fingerprint defence (scansOpening on system+assistant,
array text parts, forceNeutralHead, perturbChannelFingerprints, breakIdentityClauses,
the retry ladder). The local customization changes only the REPLACEMENT side:

  * a fingerprinted LINE is replaced in place with Chinese text (the Web GUI
    paragraph -> WEB_GUI_PROMPT_ZH, any other identity line ->
    WORKBUDDY_FALLBACK_SYSTEM_PROMPT) instead of prepending an English head;
  * matching runs per LINE, because the gateway was measured to reject the English
    Web-GUI paragraph mid-content too.

Anchors are exact-match and must hit EXACTLY once, so an upstream refactor fails
loudly instead of producing a half-patched file.
"""
import io
import json
import sys

TARGET = sys.argv[1]
ANCHORS = sys.argv[2]

with io.open(ANCHORS, encoding='utf-8') as fh:
    anchors = json.load(fh)

with io.open(TARGET, encoding='utf-8') as fh:
    source = fh.read()

for item in anchors:
    label, old, new = item['label'], item['old'], item['new']
    count = source.count(old)
    if count != 1:
        raise SystemExit('anchor %s matched %d times (expected 1)' % (label, count))
    source = source.replace(old, new)

with io.open(TARGET, 'w', encoding='utf-8', newline='\n') as fh:
    fh.write(source)

print('patched', TARGET)