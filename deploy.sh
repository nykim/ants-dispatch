#!/usr/bin/env bash
# Deploy infra (CDK) and the SPA in one shot.
# Usage:  ./deploy.sh                       # env=dev, both
#         ./deploy.sh prod                  # env=prod, both
#         ./deploy.sh dev --infra-only      # CDK only
#         ./deploy.sh dev --web-only        # SPA only
#         ./deploy.sh dev --skip-build      # SPA: reuse web/dist
#         ./deploy.sh dev --stacks "ApiStack DeliveryStack"
set -euo pipefail

ENV="dev"
SKIP_BUILD=0
INFRA_ONLY=0
WEB_ONLY=0
STACKS=""

for arg in "$@"; do
  case "$arg" in
    dev|prod)         ENV="$arg" ;;
    --skip-build)     SKIP_BUILD=1 ;;
    --infra-only)     INFRA_ONLY=1 ;;
    --web-only)       WEB_ONLY=1 ;;
    --stacks=*)       STACKS="${arg#--stacks=}" ;;
    --stacks)         ;; # value comes as next arg, handled below
    *) ;;
  esac
done
# Allow `--stacks "A B"` form
prev=""
for arg in "$@"; do
  if [[ "$prev" == "--stacks" ]]; then STACKS="$arg"; fi
  prev="$arg"
done

if [[ "$INFRA_ONLY" -eq 1 && "$WEB_ONLY" -eq 1 ]]; then
  echo "Cannot combine --infra-only and --web-only." >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
say() { printf '\033[1;36m›\033[0m %s\n' "$*"; }
section() { printf '\n\033[1;35m━━ %s ━━\033[0m\n' "$*"; }

if [[ "$WEB_ONLY" -ne 1 ]]; then
  section "Infra (CDK · env=$ENV)"
  cd "$REPO_ROOT/infra"
  if [[ -n "$STACKS" ]]; then
    say "Deploying stacks: $STACKS"
    # shellcheck disable=SC2086
    npx cdk deploy $STACKS -c env="$ENV" --require-approval never
  else
    say "Deploying all stacks"
    npx cdk deploy --all -c env="$ENV" --require-approval never
  fi
fi

if [[ "$INFRA_ONLY" -ne 1 ]]; then
  section "Web (SPA · env=$ENV)"
  cd "$REPO_ROOT/web"
  if [[ "$SKIP_BUILD" -eq 1 ]]; then
    ./deploy.sh "$ENV" --skip-build
  else
    ./deploy.sh "$ENV"
  fi
fi

section "Done"
