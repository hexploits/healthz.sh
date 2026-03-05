#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

step=0
step() {
  step=$((step + 1))
  echo ""
  echo -e "${BLUE}${BOLD}[$step] $1${NC}"
  echo -e "${BLUE}$(printf '%.0s─' {1..60})${NC}"
}

info()    { echo -e "    ${CYAN}$1${NC}"; }
success() { echo -e "    ${GREEN}$1${NC}"; }
warn()    { echo -e "    ${YELLOW}$1${NC}"; }
fail()    { echo -e "    ${RED}$1${NC}"; exit 1; }

# ---------------------------------------------------------------------------
# Parse healthz.yaml to extract regions and primary region
# ---------------------------------------------------------------------------
parse_config() {
  if [[ ! -f healthz.yaml ]]; then
    fail "healthz.yaml not found in project root. Create one before deploying."
  fi

  # Extract regions (lines under "regions:" until next top-level key)
  REGIONS=()
  in_regions=false
  while IFS= read -r line; do
    if [[ "$line" =~ ^regions: ]]; then
      in_regions=true
      continue
    fi
    if $in_regions; then
      if [[ "$line" =~ ^[a-z] ]]; then
        break
      fi
      if [[ "$line" =~ ^[[:space:]]*-[[:space:]]*(.*) ]]; then
        local val="${BASH_REMATCH[1]}"
        val="${val%%#*}"     # strip inline comments
        val="${val%% *}"     # strip trailing whitespace
        val="${val%$'\t'*}"  # strip trailing tabs
        [[ -n "$val" ]] && REGIONS+=("$val")
      fi
    fi
  done < healthz.yaml

  # Extract primary_region
  PRIMARY_REGION=$(grep 'primary_region:' healthz.yaml | awk '{print $2}')

  if [[ ${#REGIONS[@]} -eq 0 ]]; then
    fail "No regions found in healthz.yaml"
  fi
  if [[ -z "$PRIMARY_REGION" ]]; then
    fail "No primary_region found in healthz.yaml settings"
  fi

  # Extract branding (optional)
  COMPANY_NAME=$(grep 'company_name:' healthz.yaml | head -1 | sed 's/.*company_name:[[:space:]]*//' | sed 's/[[:space:]]*$//')
  COMPANY_URL=$(grep 'company_url:' healthz.yaml | head -1 | sed 's/.*company_url:[[:space:]]*//' | sed 's/[[:space:]]*$//')
  THEME_MODE=$(grep 'theme_mode:' healthz.yaml | head -1 | sed 's/.*theme_mode:[[:space:]]*//' | sed 's/[[:space:]]*$//' || true)
  PRIMARY_COLOR=$(grep 'primary_color:' healthz.yaml | head -1 | sed 's/.*primary_color:[[:space:]]*//' | sed "s/[[:space:]]*$//" | sed "s/['\"]//g" || true)

  # Extract domain config (optional)
  DOMAIN_NAMES=()
  local in_domain=false in_names=false
  while IFS= read -r line; do
    if [[ "$line" =~ ^domain: ]]; then
      in_domain=true
      continue
    fi
    if $in_domain; then
      if [[ "$line" =~ ^[a-z] ]]; then
        break
      fi
      if [[ "$line" =~ ^[[:space:]]*names: ]]; then
        in_names=true
        continue
      fi
      if $in_names; then
        # skip blank lines and comments
        if [[ "$line" =~ ^[[:space:]]*$ ]] || [[ "$line" =~ ^[[:space:]]*# ]]; then
          continue
        fi
        if [[ "$line" =~ ^[[:space:]]*-[[:space:]]*(.*) ]]; then
          local dval="${BASH_REMATCH[1]}"
          dval="${dval%%#*}"
          dval="${dval%% *}"
          [[ -n "$dval" ]] && DOMAIN_NAMES+=("$dval")
        else
          in_names=false
        fi
      fi
    fi
  done < healthz.yaml

  HOSTED_ZONE_ID=$(grep -v '^ *#' healthz.yaml | grep 'hosted_zone_id:' | head -1 | awk '{print $2}' || true)
  ZONE_NAME=$(grep -v '^ *#' healthz.yaml | grep 'zone_name:' | head -1 | awk '{print $2}' || true)
  CERT_ARN=""
}

# ---------------------------------------------------------------------------
# Preflight checks
# ---------------------------------------------------------------------------
preflight() {
  step "Checking prerequisites"

  local missing=false

  if command -v node &>/dev/null; then
    success "Node.js $(node -v)"
  else
    warn "Node.js not found — install Node.js 22+"
    missing=true
  fi

  if command -v npm &>/dev/null; then
    success "npm $(npm -v)"
  else
    warn "npm not found"
    missing=true
  fi

  if command -v aws &>/dev/null; then
    success "AWS CLI $(aws --version 2>&1 | awk '{print $1}')"
  else
    warn "AWS CLI not found — install from https://aws.amazon.com/cli/"
    missing=true
  fi

  if $missing; then
    fail "Missing prerequisites. Install them and re-run."
  fi

  # Verify AWS credentials
  if ! AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text 2>/dev/null); then
    fail "AWS credentials not configured. Run 'aws configure' or export AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY."
  fi
  success "AWS Account: $AWS_ACCOUNT_ID"

  AWS_IDENTITY=$(aws sts get-caller-identity --query Arn --output text)
  success "Identity:    $AWS_IDENTITY"
}

# ---------------------------------------------------------------------------
# Read config
# ---------------------------------------------------------------------------
show_config() {
  step "Reading healthz.yaml"

  parse_config

  info "Primary region: $PRIMARY_REGION"
  info "All regions:    ${REGIONS[*]}"
  info "Stacks to deploy:"
  info "  - HealthzGlobalTable        ($PRIMARY_REGION)"
  for r in "${REGIONS[@]}"; do
    info "  - HealthzChecker-$r  ($r)"
  done
  info "  - HealthzDashboard          ($PRIMARY_REGION)"
}

# ---------------------------------------------------------------------------
# Install dependencies
# ---------------------------------------------------------------------------
install_deps() {
  step "Installing dependencies"
  npm ci
  success "Dependencies installed"
}

# ---------------------------------------------------------------------------
# Bootstrap CDK in all regions
# ---------------------------------------------------------------------------
bootstrap_cdk() {
  step "Bootstrapping CDK in all regions"

  local unique_regions=()
  declare -A seen
  for r in "${REGIONS[@]}"; do
    if [[ -z "${seen[$r]:-}" ]]; then
      unique_regions+=("$r")
      seen[$r]=1
    fi
  done
  # primary region might not be in the regions list
  if [[ -z "${seen[$PRIMARY_REGION]:-}" ]]; then
    unique_regions+=("$PRIMARY_REGION")
  fi

  for region in "${unique_regions[@]}"; do
    info "Bootstrapping aws://$AWS_ACCOUNT_ID/$region ..."
    npx cdk bootstrap "aws://$AWS_ACCOUNT_ID/$region" --quiet 2>&1 | while IFS= read -r line; do
      echo "      $line"
    done
    success "Bootstrapped $region"
  done
}

# ---------------------------------------------------------------------------
# Provision TLS certificate (external DNS only)
# ---------------------------------------------------------------------------
provision_certificate() {
  # Skip if no custom domain configured
  [[ ${#DOMAIN_NAMES[@]} -eq 0 ]] && return

  # Skip if Route53 — CDK handles it
  if [[ -n "${HOSTED_ZONE_ID:-}" && -n "${ZONE_NAME:-}" ]]; then
    info "Route53 hosted zone configured — CDK will create and validate the certificate"
    return
  fi

  step "Provisioning TLS certificate (external DNS)"

  local primary_domain="${DOMAIN_NAMES[0]}"

  # Check for existing certificate matching this domain
  CERT_ARN=$(aws acm list-certificates \
    --region us-east-1 \
    --query "CertificateSummaryList[?DomainName=='${primary_domain}'].CertificateArn | [0]" \
    --output text 2>/dev/null || true)

  if [[ "$CERT_ARN" == "None" || -z "$CERT_ARN" ]]; then
    info "Requesting new certificate for ${primary_domain} ..."

    local san_args=""
    if [[ ${#DOMAIN_NAMES[@]} -gt 1 ]]; then
      san_args="--subject-alternative-names"
      for d in "${DOMAIN_NAMES[@]:1}"; do
        san_args="$san_args $d"
      done
    fi

    CERT_ARN=$(aws acm request-certificate \
      --domain-name "$primary_domain" \
      $san_args \
      --validation-method DNS \
      --region us-east-1 \
      --query CertificateArn \
      --output text)

    success "Certificate requested: $CERT_ARN"
    info "Waiting for ACM to generate validation records..."
    sleep 5
  else
    success "Found existing certificate: $CERT_ARN"
  fi

  # Check validation status
  local cert_status
  cert_status=$(aws acm describe-certificate \
    --certificate-arn "$CERT_ARN" \
    --region us-east-1 \
    --query "Certificate.Status" \
    --output text)

  if [[ "$cert_status" == "ISSUED" ]]; then
    success "Certificate is validated and active"
    return
  fi

  # Certificate needs validation — print the DNS records
  echo ""
  warn "Certificate is PENDING VALIDATION"
  echo ""
  echo -e "    ${BOLD}Add the following CNAME record(s) in your DNS provider (e.g. Cloudflare):${NC}"
  echo ""

  local validation_json
  validation_json=$(aws acm describe-certificate \
    --certificate-arn "$CERT_ARN" \
    --region us-east-1 \
    --query "Certificate.DomainValidationOptions[].[DomainName,ResourceRecord.Name,ResourceRecord.Value]" \
    --output json)

  local count
  count=$(echo "$validation_json" | jq 'length')
  for i in $(seq 0 $((count - 1))); do
    local domain name value
    domain=$(echo "$validation_json" | jq -r ".[$i][0]")
    name=$(echo "$validation_json" | jq -r ".[$i][1]")
    value=$(echo "$validation_json" | jq -r ".[$i][2]")
    echo -e "    ${BOLD}Domain:${NC}  $domain"
    echo -e "    ${BOLD}Type:${NC}    CNAME"
    echo -e "    ${BOLD}Name:${NC}    ${CYAN}${name}${NC}"
    echo -e "    ${BOLD}Value:${NC}   ${CYAN}${value}${NC}"
    echo -e "    ${BOLD}TTL:${NC}     Auto or 300"
    if [ "$i" -lt $((count - 1)) ]; then echo ""; fi
  done

  echo ""
  echo -e "    ${BOLD}Cloudflare users:${NC} Set proxy to ${BOLD}DNS only${NC} (grey cloud, not orange)"
  echo ""
  echo -e "    ${CYAN}After adding the record(s), re-run ./deploy.sh${NC}"
  echo -e "    ${CYAN}Validation usually completes within 1-5 minutes.${NC}"
  echo ""
  exit 0
}

# ---------------------------------------------------------------------------
# Build all packages
# ---------------------------------------------------------------------------
build_all() {
  step "Building all packages"

  info "Cleaning previous build artifacts ..."
  npx turbo clean 2>&1 | while IFS= read -r line; do
    echo "      $line"
  done

  if [[ -n "${COMPANY_NAME:-}" ]]; then
    export NEXT_PUBLIC_COMPANY_NAME="$COMPANY_NAME"
    info "Branding: $COMPANY_NAME"
  fi
  if [[ -n "${COMPANY_URL:-}" ]]; then
    export NEXT_PUBLIC_COMPANY_URL="$COMPANY_URL"
  fi
  if [[ -n "${THEME_MODE:-}" ]]; then
    export NEXT_PUBLIC_THEME_MODE="$THEME_MODE"
    info "Theme mode: $THEME_MODE"
  fi
  if [[ -n "${PRIMARY_COLOR:-}" ]]; then
    export NEXT_PUBLIC_PRIMARY_COLOR="$PRIMARY_COLOR"
    info "Primary color: $PRIMARY_COLOR"
  fi

  local logo_dark logo_light
  logo_dark=$(find packages/ui/public -maxdepth 1 -name 'logo-dark.*' -printf '%f\n' 2>/dev/null | head -1)
  logo_light=$(find packages/ui/public -maxdepth 1 -name 'logo-light.*' -printf '%f\n' 2>/dev/null | head -1)
  if [[ -n "$logo_dark" ]]; then
    export NEXT_PUBLIC_LOGO_DARK="$logo_dark"
    info "Logo (dark): packages/ui/public/$logo_dark"
  fi
  if [[ -n "$logo_light" ]]; then
    export NEXT_PUBLIC_LOGO_LIGHT="$logo_light"
    info "Logo (light): packages/ui/public/$logo_light"
  fi

  if ls packages/ui/public/fonts/*.woff2 packages/ui/public/fonts/*.otf packages/ui/public/fonts/*.woff packages/ui/public/fonts/*.ttf &>/dev/null; then
    export NEXT_PUBLIC_FONT=true
    info "Custom font: packages/ui/public/fonts/"
  fi

  info "Building types, checker, api, and ui ..."
  npx turbo build 2>&1 | while IFS= read -r line; do
    echo "      $line"
  done
  success "All packages built"

  if [[ ! -d packages/ui/out ]]; then
    fail "UI build output not found at packages/ui/out — Next.js static export may have failed."
  fi
  success "UI static export ready (packages/ui/out)"
}

# ---------------------------------------------------------------------------
# Clean up orphaned stacks from removed regions or primary region changes
# ---------------------------------------------------------------------------
cleanup_orphaned_stacks() {
  step "Checking for orphaned stacks"

  local all_regions=(
    us-east-1 us-east-2 us-west-1 us-west-2
    eu-west-1 eu-west-2 eu-west-3 eu-central-1 eu-north-1
    ap-southeast-1 ap-southeast-2 ap-northeast-1 ap-northeast-2 ap-south-1
    sa-east-1 ca-central-1
  )

  # Build sets of expected stacks and their regions
  declare -A desired_checkers
  for r in "${REGIONS[@]}"; do
    desired_checkers["HealthzChecker-$r"]="$r"
  done

  local orphaned_names=()
  local orphaned_regions=()

  for check_region in "${all_regions[@]}"; do
    local stacks
    stacks=$(aws cloudformation list-stacks \
      --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE UPDATE_ROLLBACK_COMPLETE \
      --query "StackSummaries[?starts_with(StackName, 'Healthz')].StackName" \
      --output text --region "$check_region" 2>/dev/null) || continue

    for stack_name in $stacks; do
      local should_destroy=false

      case "$stack_name" in
        HealthzChecker-*)
          # Orphaned if not in desired checkers, or if it's in the wrong region
          if [[ -z "${desired_checkers[$stack_name]:-}" ]]; then
            should_destroy=true
          elif [[ "${desired_checkers[$stack_name]}" != "$check_region" ]]; then
            should_destroy=true
          fi
          ;;
        HealthzGlobalTable)
          # Orphaned if found in a region that's not the current primary
          if [[ "$check_region" != "$PRIMARY_REGION" ]]; then
            should_destroy=true
          fi
          ;;
        HealthzDashboard)
          # Orphaned if found in a region that's not the current primary
          if [[ "$check_region" != "$PRIMARY_REGION" ]]; then
            should_destroy=true
          fi
          ;;
      esac

      if $should_destroy; then
        orphaned_names+=("$stack_name")
        orphaned_regions+=("$check_region")
      fi
    done
  done

  if [[ ${#orphaned_names[@]} -eq 0 ]]; then
    success "No orphaned stacks found"
    return
  fi

  for i in "${!orphaned_names[@]}"; do
    local stack_name="${orphaned_names[$i]}"
    local stack_region="${orphaned_regions[$i]}"
    warn "Destroying orphaned stack: $stack_name ($stack_region)"

    aws cloudformation delete-stack --stack-name "$stack_name" --region "$stack_region" 2>&1 | while IFS= read -r line; do
      echo "      $line"
    done
    aws cloudformation wait stack-delete-complete --stack-name "$stack_name" --region "$stack_region" 2>&1 | while IFS= read -r line; do
      echo "      $line"
    done

    success "Destroyed $stack_name in $stack_region"
  done
}

# ---------------------------------------------------------------------------
# Deploy CDK stacks
# ---------------------------------------------------------------------------
deploy_stacks() {
  step "Deploying all CDK stacks"

  info "This will create/update: DynamoDB global table, Lambda checkers, API Gateway, S3, CloudFront"
  info "Deploying..."
  echo ""

  cd "$SCRIPT_DIR/infra"

  local cdk_args=(deploy --all --require-approval never --outputs-file "$SCRIPT_DIR/cdk-outputs.json")
  if [[ -n "${CERT_ARN:-}" ]]; then
    cdk_args+=(--context "certificateArn=$CERT_ARN")
  fi

  npx cdk "${cdk_args[@]}" 2>&1 | while IFS= read -r line; do
    # Highlight stack deployment progress
    if [[ "$line" == *"deploying..."* ]] || [[ "$line" == *"creating"* ]] || [[ "$line" == *"UPDATE_COMPLETE"* ]] || [[ "$line" == *"CREATE_COMPLETE"* ]]; then
      echo -e "    ${GREEN}$line${NC}"
    elif [[ "$line" == *"fail"* ]] || [[ "$line" == *"ROLLBACK"* ]] || [[ "$line" == *"error"* ]]; then
      echo -e "    ${RED}$line${NC}"
    else
      echo "      $line"
    fi
  done
  cd "$SCRIPT_DIR"

  success "All stacks deployed"
}

# ---------------------------------------------------------------------------
# Print summary
# ---------------------------------------------------------------------------
print_summary() {
  step "Deployment complete"

  echo ""
  echo -e "${GREEN}${BOLD}  Deployment successful!${NC}"
  echo ""

  if [[ -f cdk-outputs.json ]]; then
    # Extract dashboard URL
    DASHBOARD_URL=$(python3 -c "
import json, sys
data = json.load(open('cdk-outputs.json'))
for stack in data.values():
    for key, val in stack.items():
        if 'DashboardUrl' in key:
            print(val)
            sys.exit(0)
" 2>/dev/null || true)

    API_URL=$(python3 -c "
import json, sys
data = json.load(open('cdk-outputs.json'))
for stack in data.values():
    for key, val in stack.items():
        if 'ApiUrl' in key:
            print(val)
            sys.exit(0)
" 2>/dev/null || true)

    CF_DOMAIN=$(python3 -c "
import json, sys
data = json.load(open('cdk-outputs.json'))
for stack in data.values():
    for key, val in stack.items():
        if 'CloudFrontDomain' in key:
            print(val)
            sys.exit(0)
" 2>/dev/null || true)

    if [[ -n "$DASHBOARD_URL" ]]; then
      echo -e "  ${BOLD}Dashboard:${NC}  $DASHBOARD_URL"
    fi
    if [[ -n "$API_URL" ]]; then
      echo -e "  ${BOLD}API:${NC}        $API_URL"
    fi

    # Show DNS instructions if custom domain is configured
    CUSTOM_DOMAINS=$(grep -A5 '^domain:' healthz.yaml 2>/dev/null | grep '^ *- ' | sed 's/.*- //' | sed 's/[[:space:]]*$//')
    if [[ -n "$CUSTOM_DOMAINS" && -n "$CF_DOMAIN" ]]; then
      echo ""
      echo -e "  ${BOLD}DNS Setup:${NC}"
      while IFS= read -r domain; do
        echo -e "    ${CYAN}$domain${NC}  CNAME → ${CYAN}$CF_DOMAIN${NC}"
      done <<< "$CUSTOM_DOMAINS"
    fi
  fi

  echo ""
  echo -e "  ${BOLD}Regions:${NC}    ${REGIONS[*]}"
  echo -e "  ${BOLD}Account:${NC}    $AWS_ACCOUNT_ID"
  echo ""
  echo -e "  ${CYAN}Checkers will start running on their configured intervals.${NC}"
  echo -e "  ${CYAN}Data should appear on the dashboard within a few minutes.${NC}"
  echo ""
  echo -e "  ${YELLOW}To tear down:  cd infra && npx cdk destroy --all${NC}"
  echo ""
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
echo ""
echo -e "${GREEN}${BOLD}  healthz.sh — Deploy${NC}"
echo -e "${GREEN}$(printf '%.0s═' {1..60})${NC}"

preflight
show_config
provision_certificate
install_deps
bootstrap_cdk
build_all
deploy_stacks
cleanup_orphaned_stacks
print_summary
