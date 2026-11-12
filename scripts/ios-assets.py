"""Builds the iOS app icon, launch image and lock-screen icon from public/icons (run from repo root)."""
import json, os
from PIL import Image

BG = (10, 10, 11)
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
assets = os.path.join(root, 'ios/App/App/Assets.xcassets')
master = Image.open(os.path.join(root, 'public/icons/ios-appicon-1024.png')).convert('RGBA')

# 1. App icon: 1024x1024, opaque (App Store rejects alpha)
icon = Image.new('RGB', (1024, 1024), BG)
icon.paste(master, (0, 0), master)
icon.save(os.path.join(assets, 'AppIcon.appiconset/AppIcon-512@2x.png'), optimize=True)

# 2. Launch image: dark square, icon in the middle (shown aspect-fill on every iPhone)
rounded = Image.open(os.path.join(root, 'public/icons/icon-512.png')).convert('RGBA').resize((384, 384), Image.LANCZOS)
splash = Image.new('RGB', (2732, 2732), BG)
splash.paste(rounded, ((2732 - 384) // 2, (2732 - 384) // 2), rounded)
for n in ('splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png'):
    splash.save(os.path.join(assets, 'Splash.imageset', n), optimize=True)

# 3. Small icon for the app-switcher privacy cover
li = os.path.join(assets, 'LaunchIcon.imageset')
os.makedirs(li, exist_ok=True)
Image.open(os.path.join(root, 'public/icons/icon-512.png')).convert('RGBA').resize((288, 288), Image.LANCZOS).save(os.path.join(li, 'launch-icon@3x.png'))
json.dump({'images': [{'idiom': 'universal', 'filename': 'launch-icon@3x.png', 'scale': '3x'}], 'info': {'author': 'xcode', 'version': 1}},
          open(os.path.join(li, 'Contents.json'), 'w'), indent=2)
print('ios assets written')
