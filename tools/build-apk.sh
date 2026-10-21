#!/bin/bash
# Build the debug APK.
# The toolchain lives in .toolchain/ inside the repo (persistent volume) —
# see tools/android-toolchain.sh.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export JAVA_HOME="$ROOT/.toolchain/jdk"
export ANDROID_HOME="$ROOT/.toolchain/android-sdk"
export ANDROID_SDK_ROOT=$ANDROID_HOME
export PATH="$JAVA_HOME/bin:$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools"
export GRADLE_OPTS="-Dorg.gradle.jvmargs=-Xmx3g"

cd "$ROOT"
if [ ! -x "$JAVA_HOME/bin/javac" ]; then
  echo "!! toolchain missing — run: bash tools/android-toolchain.sh" >&2
  exit 1
fi

echo "=== stage web assets ==="
node tools/stage-web.js

echo "=== cap sync android ==="
npx cap sync android

echo "=== gradle assembleDebug ==="
# Use a local Gradle distribution: the wrapper's own download endpoint is
# unreliable behind this network. The wrapper stays in the repo so it works
# normally on a normal machine.
GRADLE="$ROOT/.toolchain/gradle-8.14.3/bin/gradle"
cd android
chmod +x gradlew
if [ -x "$GRADLE" ]; then
  "$GRADLE" assembleDebug --no-daemon --console=plain
else
  ./gradlew assembleDebug --no-daemon --console=plain
fi

echo "=== result ==="
find app/build/outputs/apk -name "*.apk" -exec ls -lh {} \;
