#!/bin/bash
# Create a release keystore for VibeJournal.
#
#   bash tools/make-keystore.sh
#
# Run this ONCE, on your own machine. The keystore is the key to every future
# update of the app — if you lose it, Android will refuse to install any
# newer version over the existing one (you would have to uninstall first and
# lose the app's data). Back it up somewhere safe, right now.
#
# It writes:
#   android/vibejournal.keystore   (the key)
#   android/keystore.properties     (the passwords, gitignored)
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

KEYSTORE="android/vibejournal.keystore"
PROPS="android/keystore.properties"
ALIAS="vibejournal"

if [ -f "$KEYSTORE" ]; then
  echo "!! $KEYSTORE already exists — refusing to overwrite it." >&2
  echo "   (that key is probably already signing your app)" >&2
  exit 1
fi

read -r -p "Keystore password (min 6 chars): " PW
read -r -p "Key password (press Enter for same): " KEY_PW
KEY_PW=${KEY_PW:-$PW}

KEYTOOL=""
for j in "$ROOT"/.toolchain/jdk/bin/keytool \
         "$ROOT"/.toolchain/android-sdk/build-tools/*/keytool \
         /usr/lib/jvm/*/bin/keytool; do
  [ -x "$j" ] && KEYTOOL="$j" && break
done
if [ -z "$KEYTOOL" ]; then
  echo "!! keytool not found. Install a JDK (17+) or run tools/android-toolchain.sh" >&2
  exit 1
fi

echo "=== generating $ALIAS keystore (valid 30 years) ==="
"$KEYTOOL" -genkeypair -v \
  -keystore "$KEYSTORE" \
  -alias "$ALIAS" \
  -keyalg RSA -keysize 4096 -validity 10950 \
  -storetype PKCS12 \
  -storepass "$PW" -keypass "$KEY_PW" \
  -dname "CN=VibeJournal, OU=Personal, O=VibeJournal, L=Unknown, ST=Unknown, C=PK"

cat > "$PROPS" <<EOF
storeFile=$KEYSTORE
storePassword=$PW
keyAlias=$ALIAS
keyPassword=$KEY_PW
EOF

echo
echo "✓ $KEYSTORE created"
echo "✓ $PROPS written (gitignored)"
echo
echo "BACK THESE UP NOW. Lose the keystore and you can never update the app"
echo "without uninstalling it first — which deletes your journal data."
echo
echo "Next:"
echo "  bash tools/build-release.sh"
