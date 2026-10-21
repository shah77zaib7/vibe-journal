#!/bin/bash
# Build a signed release APK.
# Requires: bash tools/make-keystore.sh   (once)
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export JAVA_HOME="$ROOT/.toolchain/jdk"
export ANDROID_HOME="$ROOT/.toolchain/android-sdk"
export ANDROID_SDK_ROOT=$ANDROID_HOME
export PATH="$JAVA_HOME/bin:$PATH:$ANDROID_HOME/cmdline-tools/latest/bin"
export GRADLE_OPTS="-Dorg.gradle.jvmargs=-Xmx3g"

cd "$ROOT"
PROPS="android/keystore.properties"
if [ ! -f "$PROPS" ]; then
  echo "!! $PROPS not found — run: bash tools/make-keystore.sh" >&2
  exit 1
fi

echo "=== stage web assets ==="
node tools/stage-web.js
npx cap sync android

echo "=== configure signing ==="
cd android
python3 - <<'PY'
import os, re
props = {}
for line in open('keystore.properties'):
    if '=' in line:
        k, v = line.strip().split('=', 1)
        props[k] = v

# inject the signing config into app/build.gradle
g = open('app/build.gradle').read()
if 'VibeRelease' not in g:
    g = g.replace("""    buildTypes {
        release {""", """    signingConfigs {
        VibeRelease {
            storeFile file('../' + props['storeFile'])
            storePassword props['storePassword']
            keyAlias props['keyAlias']
            keyPassword props['keyPassword']
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.VibeRelease""")
    open('app/build.gradle', 'w').write(g)
    print('  ✓ signing config injected')
else:
    print('  · signing config already present')
PY

echo "=== gradle assembleRelease ==="
GRADLE="$ROOT/.toolchain/gradle-8.14.3/bin/gradle"
if [ -x "$GRADLE" ]; then "$GRADLE" assembleRelease --no-daemon --console=plain
else ./gradlew assembleRelease --no-daemon --console=plain; fi

echo "=== result ==="
find app/build/outputs/apk -name "*.apk" -exec ls -lh {} \;
