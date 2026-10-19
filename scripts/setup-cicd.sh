#!/usr/bin/env bash
# Interactive setup for this repo's CI/CD: sets the test/prod instance URLs,
# picks basic or oauth per instance, prompts for the needed credentials, and
# pushes all of it as GitHub repo variables/secrets via `gh`. See the "Set up GitHub and ServiceNow" section of README.md
# for the manual equivalent of everything this script does.
set -euo pipefail

TEST_AUTH=""
PROD_AUTH=""
REPO_SLUG=""

usage() {
  cat <<'EOF'
Usage: scripts/setup-cicd.sh [--test basic|oauth] [--prod basic|oauth] [--repo <owner>/<repo>]

Omitted flags are asked for interactively. Example:
  scripts/setup-cicd.sh --test basic --prod oauth
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --test) TEST_AUTH="$2"; shift 2 ;;
    --prod) PROD_AUTH="$2"; shift 2 ;;
    --repo) REPO_SLUG="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage; exit 1 ;;
  esac
done

if ! command -v gh >/dev/null 2>&1; then
  echo "error: this script requires the GitHub CLI (gh). Install it from https://cli.github.com/" >&2
  exit 1
fi

ask() {
  local prompt="$1" default="${2:-}" reply
  if [ -n "$default" ]; then
    read -r -p "$prompt [$default]: " reply
    echo "${reply:-$default}"
  else
    read -r -p "$prompt: " reply
    echo "$reply"
  fi
}

ask_secret() {
  local prompt="$1" reply
  read -r -s -p "$prompt: " reply
  echo >&2
  echo "$reply"
}

# Accepts an instance name (acme), a host (acme.service-now.com), or a URL
# (https://acme.service-now.com/) and returns https://<host>: lowercase, no
# path, no trailing slash. A bare name gets ".service-now.com" appended.
normalize_instance_url() {
  local v scheme host
  v="$(printf '%s' "$1" | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]')"
  case "$v" in
    http://*|https://*) ;;
    *) v="https://$v" ;;
  esac
  scheme="${v%%://*}"
  host="${v#*://}"
  host="${host%%[/?#]*}"
  case "$host" in
    *.*|localhost*) ;;
    *) host="$host.service-now.com" ;;
  esac
  printf '%s://%s' "$scheme" "$host"
}

ask_instance() {
  local reply
  reply="$(ask_required "$1" "$2")"
  normalize_instance_url "$reply"
}

ask_auth_type() {
  local label="$1" default="$2" reply
  while true; do
    reply="$(ask "$label (basic/oauth)" "$default")"
    case "$reply" in
      basic|oauth) echo "$reply"; return 0 ;;
      *) echo "Please enter 'basic' or 'oauth'." >&2 ;;
    esac
  done
}

ask_required() {
  local prompt="$1" default="${2:-}" reply
  while true; do
    reply="$(ask "$prompt" "$default")"
    [ -n "$reply" ] && { echo "$reply"; return 0; }
    echo "This is required — the pipeline won't run without it." >&2
  done
}

# Sets a secret only if a value was entered; leaves any existing secret
# untouched when the prompt is left blank (e.g. re-running the script
# without wanting to change a credential that's already configured).
set_secret_if_provided() {
  local name="$1" value="$2"
  if [ -n "$value" ]; then
    gh secret set "$name" --repo "$REPO_SLUG" --body "$value"
  else
    echo "  (left blank — leaving $name unchanged)"
  fi
}

# Sets a variable only if the new value differs from what's already there,
# so re-running with all-default answers is a true no-op.
set_variable_if_changed() {
  local name="$1" value="$2" current
  current="$(gh variable get "$name" --repo "$REPO_SLUG" 2>/dev/null || true)"
  if [ "$value" != "$current" ]; then
    gh variable set "$name" --repo "$REPO_SLUG" --body "$value"
  else
    echo "  ($name already $value — unchanged)"
  fi
}

if [ -z "$REPO_SLUG" ]; then
  REPO_SLUG="$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || true)"
fi
if [ -z "$REPO_SLUG" ]; then
  REPO_SLUG="$(ask "GitHub repo (owner/repo)")"
fi

# Current values become the prompt defaults, so hitting enter through every
# prompt reproduces the existing config instead of resetting it.
CURRENT_TEST_AUTH="$(gh variable get SN_SDK_TEST_AUTH_TYPE --repo "$REPO_SLUG" 2>/dev/null || true)"
CURRENT_PROD_AUTH="$(gh variable get SN_SDK_PROD_AUTH_TYPE --repo "$REPO_SLUG" 2>/dev/null || true)"
CURRENT_TEST_URL="$(gh variable get SN_SDK_TEST_INSTANCE_URL --repo "$REPO_SLUG" 2>/dev/null || true)"
CURRENT_PROD_URL="$(gh variable get SN_SDK_PROD_INSTANCE_URL --repo "$REPO_SLUG" 2>/dev/null || true)"
CURRENT_TEST_USER="$(gh variable get SN_SDK_TEST_USER --repo "$REPO_SLUG" 2>/dev/null || true)"
CURRENT_PROD_USER="$(gh variable get SN_SDK_PROD_USER --repo "$REPO_SLUG" 2>/dev/null || true)"

echo "Configuring CI/CD auth for $REPO_SLUG"
echo "TEST = the instance update sets are committed to first. PROD = the instance they are promoted to after approval."
echo "New here and just want it running? basic auth for both TEST and PROD is the least setup (no ServiceNow OAuth app registry needed)."
echo
echo "Press Enter on any prompt to keep its current/default value shown in [brackets]."

# Everything for one instance lives together under its own header, in the
# order you're actually asked for it: auth type, then URL, then credentials.
echo
echo "== Configure TEST Instance =="
[ -n "$TEST_AUTH" ] || TEST_AUTH="$(ask_auth_type "  Auth type" "${CURRENT_TEST_AUTH:-basic}")"
TEST_URL="$(ask_instance "  Instance name or URL" "$CURRENT_TEST_URL")"
if [ "$TEST_AUTH" = "basic" ]; then
  TEST_USER="$(ask_required "  Basic-auth username on $TEST_URL" "$CURRENT_TEST_USER")"
  TEST_PWD="$(ask_secret "  Password for $TEST_USER on $TEST_URL (leave blank to keep the existing secret)")"
  set_secret_if_provided SN_SDK_TEST_USER_PWD "$TEST_PWD"
else
  echo "  Get these from the OAuth Application Registry on $TEST_URL (see README.md 'Set up GitHub and ServiceNow' if you haven't created one yet). Leave blank to keep an existing secret."
  echo "  Tip: validate a credential first — SN_SDK_NODE_ENV=SN_SDK_CI_INSTALL SN_SDK_AUTH_TYPE=oauth SN_SDK_INSTANCE_URL=$TEST_URL SN_SDK_OAUTH_CLIENT_ID=... SN_SDK_OAUTH_CLIENT_SECRET=... npx @servicenow/sdk query sys_user -q active=true --limit 1 -o json."
  TEST_CLIENT_ID="$(ask "  Client ID")"
  TEST_CLIENT_SECRET="$(ask_secret "  Client secret")"
  set_secret_if_provided SN_SDK_TEST_OAUTH_CLIENT_ID "$TEST_CLIENT_ID"
  set_secret_if_provided SN_SDK_TEST_OAUTH_CLIENT_SECRET "$TEST_CLIENT_SECRET"
fi

echo
echo "== Configure PROD Instance =="
[ -n "$PROD_AUTH" ] || PROD_AUTH="$(ask_auth_type "  Auth type" "${CURRENT_PROD_AUTH:-basic}")"
PROD_URL="$(ask_instance "  Instance name or URL" "$CURRENT_PROD_URL")"
if [ "$PROD_AUTH" = "basic" ]; then
  PROD_USER="$(ask_required "  Basic-auth username on $PROD_URL" "$CURRENT_PROD_USER")"
  PROD_PWD="$(ask_secret "  Password for $PROD_USER on $PROD_URL (leave blank to keep the existing secret)")"
  set_secret_if_provided SN_SDK_PROD_USER_PWD "$PROD_PWD"
else
  echo "  Get these from the OAuth Application Registry on $PROD_URL (see README.md 'Set up GitHub and ServiceNow' if you haven't created one yet). Leave blank to keep an existing secret."
  echo "  Tip: validate a credential first — SN_SDK_NODE_ENV=SN_SDK_CI_INSTALL SN_SDK_AUTH_TYPE=oauth SN_SDK_INSTANCE_URL=$PROD_URL SN_SDK_OAUTH_CLIENT_ID=... SN_SDK_OAUTH_CLIENT_SECRET=... npx @servicenow/sdk query sys_user -q active=true --limit 1 -o json."
  PROD_CLIENT_ID="$(ask "  Client ID")"
  PROD_CLIENT_SECRET="$(ask_secret "  Client secret")"
  set_secret_if_provided SN_SDK_PROD_OAUTH_CLIENT_ID "$PROD_CLIENT_ID"
  set_secret_if_provided SN_SDK_PROD_OAUTH_CLIENT_SECRET "$PROD_CLIENT_SECRET"
fi

echo
echo "-- Setting variables --"
set_variable_if_changed SN_SDK_TEST_INSTANCE_URL "$TEST_URL"
set_variable_if_changed SN_SDK_PROD_INSTANCE_URL "$PROD_URL"
set_variable_if_changed SN_SDK_TEST_AUTH_TYPE "$TEST_AUTH"
set_variable_if_changed SN_SDK_PROD_AUTH_TYPE "$PROD_AUTH"
[ "$TEST_AUTH" = "basic" ] && set_variable_if_changed SN_SDK_TEST_USER "$TEST_USER"
[ "$PROD_AUTH" = "basic" ] && set_variable_if_changed SN_SDK_PROD_USER "$PROD_USER"

echo
echo "Done. TEST = $TEST_AUTH ($TEST_URL), PROD = $PROD_AUTH ($PROD_URL)."
echo "Run 'gh variable list --repo $REPO_SLUG' / 'gh secret list --repo $REPO_SLUG' to confirm what was set."
