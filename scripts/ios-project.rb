# Configures ios/App/App.xcodeproj for Daybook (idempotent). Run from the repo root:
#   ruby scripts/ios-project.rb
# Adds the native source files, localizations, version/bundle settings, the AppUITests UI-test
# target and a shared "App" scheme (so `xcodebuild -scheme App test` works on a clean checkout).
require 'xcodeproj'
require 'json'

VERSION = JSON.parse(File.read('package.json'))['version']
BUNDLE_ID = 'io.github.zijianyuangh.daybook'

path = 'ios/App/App.xcodeproj'
project = Xcodeproj::Project.open(path)
app = project.targets.find { |t| t.name == 'App' } or abort('App target missing')
group = project.main_group['App'] or abort('App group missing')

def ensure_file(group, target, name)
  ref = group.files.find { |f| f.path == name } || group.new_reference(name)
  target.add_file_references([ref]) unless target.source_build_phase.files_references.include?(ref)
  ref
end
ensure_file(group, app, 'DaybookNativePlugin.swift')
ensure_file(group, app, 'DaybookViewController.swift')

# Privacy manifest (required-reason APIs: UserDefaults, file timestamps) — copied into the app bundle
privacy = group.files.find { |f| f.path == 'PrivacyInfo.xcprivacy' } || group.new_reference('PrivacyInfo.xcprivacy')
app.resources_build_phase.add_file_reference(privacy, true)

# InfoPlist.strings (en, zh-Hans)
unless group.children.any? { |c| c.display_name == 'InfoPlist.strings' }
  vg = group.new_variant_group('InfoPlist.strings')
  %w[en zh-Hans].each { |lang| vg.new_reference("#{lang}.lproj/InfoPlist.strings").tap { |r| r.name = lang } }
  app.resources_build_phase.add_file_reference(vg)
end
project.root_object.known_regions = (project.root_object.known_regions | %w[en zh-Hans Base])

app.build_configurations.each do |c|
  s = c.build_settings
  s['PRODUCT_BUNDLE_IDENTIFIER'] = BUNDLE_ID
  s['MARKETING_VERSION'] = VERSION
  s['CURRENT_PROJECT_VERSION'] ||= '1'
  s['TARGETED_DEVICE_FAMILY'] = '1' # iPhone
  s['IPHONEOS_DEPLOYMENT_TARGET'] = '15.0'
  s['SUPPORTS_MACCATALYST'] = 'NO'
  s['CODE_SIGN_STYLE'] = 'Automatic'
  s['ASSETCATALOG_COMPILER_APPICON_NAME'] = 'AppIcon'
  s['INFOPLIST_KEY_LSApplicationCategoryType'] = 'public.app-category.finance'
end

# UI tests
tests = project.targets.find { |t| t.name == 'AppUITests' }
unless tests
  tests = project.new_target(:ui_test_bundle, 'AppUITests', :ios, '15.0')
  tests.add_dependency(app)
  tgroup = project.main_group['AppUITests'] || project.main_group.new_group('AppUITests', 'AppUITests')
  ref = tgroup.new_reference('AppUITests.swift')
  tests.add_file_references([ref])
end
tests.build_configurations.each do |c|
  s = c.build_settings
  s['TEST_TARGET_NAME'] = 'App'
  s['PRODUCT_NAME'] = '$(TARGET_NAME)'
  s['LD_RUNPATH_SEARCH_PATHS'] = ['$(inherited)', '@executable_path/Frameworks', '@loader_path/Frameworks']
  s['SWIFT_EMIT_LOC_STRINGS'] = 'NO'
  s['PRODUCT_BUNDLE_IDENTIFIER'] = "#{BUNDLE_ID}.uitests"
  s['GENERATE_INFOPLIST_FILE'] = 'YES'
  s['SWIFT_VERSION'] = '5.0'
  s['TARGETED_DEVICE_FAMILY'] = '1'
  s['IPHONEOS_DEPLOYMENT_TARGET'] = '15.0'
  s['CODE_SIGN_STYLE'] = 'Automatic'
  s['MARKETING_VERSION'] = VERSION
  s['CURRENT_PROJECT_VERSION'] = '1'
end

project.save

scheme = Xcodeproj::XCScheme.new
scheme.add_build_target(app)
scheme.set_launch_target(app)
scheme.add_test_target(tests)
scheme.save_as(path, 'App', true)
puts "configured #{path} (version #{VERSION}, #{BUNDLE_ID})"
