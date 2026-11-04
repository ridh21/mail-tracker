#!/usr/bin/env bash
# Creates (or updates) the Gmail -> Pub/Sub -> Worker push pipeline.
#
# Usage:
#   PROJECT=my-gcp-project ./scripts/setup-pubsub.sh
#   PROJECT=my-gcp-project WORKER=https://mail.example.com ./scripts/setup-pubsub.sh
#
# PROJECT may be a project id or a project number; numbers are resolved to ids
# because most gcloud Pub/Sub commands reject numbers. Omit PROJECT to use the
# active `gcloud config` project.
#
# Requires an authenticated gcloud CLI. The script is idempotent: rerun it after
# changing the Worker URL or to repair a partially configured project.
set -euo pipefail

PROJECT="${PROJECT:-$(gcloud config get-value project 2>/dev/null || true)}"
case "$PROJECT" in
  "" | "(unset)")
    echo "Set PROJECT to your Google Cloud project id, or run: gcloud config set project <id>" >&2
    exit 1
    ;;
esac

# `--project` accepts numbers for some APIs but not Pub/Sub, so normalise first.
PROJECT_ID="$(gcloud projects describe "$PROJECT" --format='value(projectId)' 2>/dev/null || true)"
if [[ -z "$PROJECT_ID" ]]; then
  echo "Cannot read project '${PROJECT}'. Check the id and that you are signed in (gcloud auth login)." >&2
  exit 1
fi
if [[ "$PROJECT_ID" != "$PROJECT" ]]; then
  echo "Resolved project number ${PROJECT} -> ${PROJECT_ID}"
fi
PROJECT="$PROJECT_ID"
WORKER="${WORKER:?Set WORKER to the deployed origin, e.g. https://mail.example.com}"
TOPIC="${TOPIC:-gmail-watch}"
SUBSCRIPTION="${SUBSCRIPTION:-gmail-watch-push}"
SA_NAME="${SA_NAME:-gmail-push}"
SA_EMAIL="${SA_NAME}@${PROJECT}.iam.gserviceaccount.com"
PUSH_URL="${WORKER%/}/webhooks/gmail"

say() { printf '\n==> %s\n' "$1"; }

say "Enabling Gmail and Pub/Sub APIs in ${PROJECT}"
gcloud services enable gmail.googleapis.com pubsub.googleapis.com --project "$PROJECT"

say "Creating topic ${TOPIC} (if missing)"
if gcloud pubsub topics describe "$TOPIC" --project "$PROJECT" >/dev/null 2>&1; then
  echo "topic already exists"
else
  gcloud pubsub topics create "$TOPIC" --project "$PROJECT"
fi

say "Allowing Gmail to publish to the topic"
gcloud pubsub topics add-iam-policy-binding "$TOPIC" --project "$PROJECT" \
  --member="serviceAccount:gmail-api-push@system.gserviceaccount.com" \
  --role="roles/pubsub.publisher" >/dev/null

say "Creating push service account ${SA_EMAIL} (if missing)"
if gcloud iam service-accounts describe "$SA_EMAIL" --project "$PROJECT" >/dev/null 2>&1; then
  echo "service account already exists"
else
  gcloud iam service-accounts create "$SA_NAME" --project "$PROJECT" \
    --display-name="Gmail Pub/Sub push"
fi

say "Letting the Pub/Sub service agent mint OIDC tokens for the push account"
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:service-${PROJECT_NUMBER}@gcp-sa-pubsub.iam.gserviceaccount.com" \
  --role="roles/iam.serviceAccountTokenCreator" \
  --condition=None >/dev/null

say "Creating or updating push subscription ${SUBSCRIPTION}"
if gcloud pubsub subscriptions describe "$SUBSCRIPTION" --project "$PROJECT" >/dev/null 2>&1; then
  gcloud pubsub subscriptions update "$SUBSCRIPTION" --project "$PROJECT" \
    --push-endpoint="$PUSH_URL" \
    --push-auth-service-account="$SA_EMAIL" \
    --push-auth-token-audience="$PUSH_URL" \
    --ack-deadline=60 >/dev/null
else
  gcloud pubsub subscriptions create "$SUBSCRIPTION" --project "$PROJECT" \
    --topic="$TOPIC" \
    --push-endpoint="$PUSH_URL" \
    --push-auth-service-account="$SA_EMAIL" \
    --push-auth-token-audience="$PUSH_URL" \
    --ack-deadline=60 >/dev/null
fi

cat <<EOF

Done. Add these two Worker variables (Cloudflare dashboard -> Worker -> Settings
-> Variables, or wrangler.jsonc), then redeploy:

  GMAIL_PUBSUB_TOPIC=projects/${PROJECT}/topics/${TOPIC}
  PUBSUB_SERVICE_ACCOUNT=${SA_EMAIL}

After deploying, open Mail Tracker -> Settings -> Sync now. That calls
users.watch immediately; otherwise the hourly cron does it.

Push endpoint: ${PUSH_URL}
Audience:      ${PUSH_URL}
EOF
