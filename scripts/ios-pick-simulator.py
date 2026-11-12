"""Prints the UDID of the best available iPhone simulator for App Store screenshots
(6.9-inch Pro Max first). Usage: xcrun simctl list devices available -j | python3 scripts/ios-pick-simulator.py"""
import json, re, sys

data = json.load(sys.stdin)['devices']
phones = []
for runtime, devices in data.items():
    m = re.search(r'iOS-(\d+)-(\d+)', runtime)
    if not m:
        continue
    version = (int(m.group(1)), int(m.group(2)))
    for d in devices:
        if d.get('isAvailable') and d['name'].startswith('iPhone'):
            phones.append((version, d['name'], d['udid']))
if not phones:
    sys.exit('no iPhone simulator available')

def score(p):
    version, name, _ = p
    pro_max = 2 if 'Pro Max' in name else 1 if 'Plus' in name or 'Air' in name else 0
    num = int((re.findall(r'iPhone (\d+)', name) or ['0'])[0])
    return (version, pro_max, num)

best = max(phones, key=score)
print(best[2])
print(f'{best[1]} (iOS {best[0][0]}.{best[0][1]})', file=sys.stderr)
