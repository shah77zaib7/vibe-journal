#!/bin/bash
# Install the Android build toolchain INTO the persistent workspace.
#
# The sandbox's /usr and /opt overlays get reset between turns, so everything
# lives under .toolchain/ on the mounted volume instead. Re-running is safe.
set -e
TC="$(cd "$(dirname "$0")/.." && pwd)/.toolchain"
JDK_DIR="$TC/jdk"
SDK_DIR="$TC/android-sdk"
CA=/etc/ssl/certs/agent-identity/sandbox-gateway-ca.crt

mkdir -p "$TC"

# ───────────────────────── JDK ─────────────────────────
if [ ! -x "$JDK_DIR/bin/javac" ]; then
  echo "=== downloading Temurin JDK 21 ==="
  mkdir -p "$TC/dl"
  curl -sSL --retry 3 --max-time 600 -o "$TC/dl/jdk.tar.gz" \
    "https://api.adoptium.net/v3/binary/latest/21/ga/linux/x64/jdk/hotspot/normal/eclipse"
  rm -rf "$JDK_DIR" "$TC/jdk-x"
  mkdir -p "$TC/jdk-x"
  tar -xzf "$TC/dl/jdk.tar.gz" -C "$TC/jdk-x"
  mv "$TC"/jdk-x/*/ "$JDK_DIR"
  rm -rf "$TC/jdk-x" "$TC/dl/jdk.tar.gz"
fi
export JAVA_HOME="$JDK_DIR"
export PATH="$JAVA_HOME/bin:$PATH"
echo "jdk: $("$JAVA_HOME/bin/java" -version 2>&1 | head -1)"

# ────── trust the sandbox gateway CA (Java doesn't read curl's bundle) ──────
JS="$JAVA_HOME/lib/security/cacerts"
if [ -L "$JS" ]; then JS=$(readlink -f "$JS" 2>/dev/null || echo "$JS"); fi
if [ ! -f "$JS" ]; then JS="$JAVA_HOME/lib/security/jssecacerts"; fi
if [ -f "$CA" ] && [ -f "$JS" ]; then
  if ! keytool -list -keystore "$JS" -storepass changeit 2>/dev/null | grep -qi sandbox-gateway; then
    cp "$JS" "$JS.bak" 2>/dev/null || true
    keytool -import -trustcacerts -noprompt -alias sandbox-gateway-ca \
      -file "$CA" -keystore "$JS" -storepass changeit >/dev/null 2>&1 \
      && echo "ca: imported sandbox gateway CA into $JS"
  else
    echo "ca: already trusted"
  fi
fi

# ───────────────────── Android cmdline-tools ─────────────────────
export ANDROID_HOME="$SDK_DIR"
export ANDROID_SDK_ROOT="$SDK_DIR"
export PATH="$PATH:$SDK_DIR/cmdline-tools/latest/bin:$SDK_DIR/platform-tools"
mkdir -p "$SDK_DIR/cmdline-tools"
if [ ! -x "$SDK_DIR/cmdline-tools/latest/bin/sdkmanager" ]; then
  echo "=== downloading Android cmdline-tools ==="
  cd "$TC"
  curl -sSL --retry 3 --max-time 600 -o cmdtools.zip \
    "https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip"
  rm -rf cmdtools_x && mkdir cmdtools_x && unzip -q cmdtools.zip -d cmdtools_x
  rm -rf "$SDK_DIR/cmdline-tools/latest"
  mv cmdtools_x/cmdline-tools "$SDK_DIR/cmdline-tools/latest"
  rm -rf cmdtools_x cmdtools.zip
fi

echo "=== accepting licenses ==="
yes | "$SDK_DIR/cmdline-tools/latest/bin/sdkmanager" --licenses >/dev/null 2>&1 || true

echo "=== installing SDK packages ==="
"$SDK_DIR/cmdline-tools/latest/bin/sdkmanager" \
  "platform-tools" "platforms;android-36" "build-tools;36.0.0" 2>&1 | tail -3

echo "=== toolchain ready ==="
"$SDK_DIR/cmdline-tools/latest/bin/sdkmanager" --list_installed 2>/dev/null | sed -n '1,10p'
