#!/usr/bin/env bash
# Generates a private CA and an origin leaf certificate for the OmniAI origin server.
#
# The leaf is what `next dev --experimental-https-*` / server.mjs present on localhost.
# The CA (certs/ca.pem) is what cloudflared trusts via `caPool` in the tunnel's
# originRequest settings. Nothing here is publicly trusted, and nothing needs to be:
# the only client is cloudflared on this machine.
#
# Re-run to renew. The leaf expires after LEAF_DAYS; the CA after CA_DAYS.
set -euo pipefail

# openssl on Git Bash mangles `-subj "/CN=..."` into a Windows path without this.
export MSYS_NO_PATHCONV=1

cd "$(dirname "$0")/.."
OUT=certs
CA_DAYS=3650
LEAF_DAYS=730

mkdir -p "$OUT"

cat > "$OUT/leaf.cnf" <<'EOF'
[req]
distinguished_name = dn
prompt             = no

[dn]
CN = openai.kerai.in

[ext]
basicConstraints       = critical,CA:FALSE
keyUsage               = critical,digitalSignature,keyEncipherment
extendedKeyUsage       = serverAuth
subjectAltName         = @alt
subjectKeyIdentifier   = hash

[alt]
DNS.1 = openai.kerai.in
DNS.2 = kerai.in
DNS.3 = localhost
IP.1  = 127.0.0.1
IP.2  = ::1
EOF

# --- Root CA -----------------------------------------------------------------
openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout "$OUT/ca-key.pem" -out "$OUT/ca.pem" \
  -days "$CA_DAYS" -sha256 \
  -subj "/CN=OmniAI Origin CA" \
  -addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
  -addext "keyUsage=critical,keyCertSign,cRLSign"

# --- Leaf, signed by that CA -------------------------------------------------
openssl req -new -newkey rsa:2048 -nodes \
  -keyout "$OUT/origin-key.pem" -out "$OUT/origin.csr" \
  -config "$OUT/leaf.cnf"

openssl x509 -req -in "$OUT/origin.csr" \
  -CA "$OUT/ca.pem" -CAkey "$OUT/ca-key.pem" -CAcreateserial \
  -out "$OUT/origin.pem" -days "$LEAF_DAYS" -sha256 \
  -extfile "$OUT/leaf.cnf" -extensions ext

cat "$OUT/origin.pem" "$OUT/ca.pem" > "$OUT/origin-fullchain.pem"
rm -f "$OUT/origin.csr" "$OUT/ca.srl"

echo
echo "Wrote:"
echo "  $OUT/ca.pem                 CA cert      -> cloudflared caPool"
echo "  $OUT/ca-key.pem             CA key       -> keep offline-ish, never leaves this box"
echo "  $OUT/origin.pem             leaf cert"
echo "  $OUT/origin-key.pem         leaf key"
echo "  $OUT/origin-fullchain.pem   leaf + CA    -> served by the origin"
echo
openssl x509 -in "$OUT/origin.pem" -noout -subject -issuer -dates -ext subjectAltName
