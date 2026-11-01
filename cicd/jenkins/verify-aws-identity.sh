#!/bin/bash
# Fail closed unless AWS credentials come from the expected IAM role.
#
# Static access keys resolve to arn:aws:iam::<account>:user/<name>; role
# credentials resolve to arn:aws:sts::<account>:assumed-role/<role>/<session>.
# Anything other than the expected role stops the pipeline before it touches AWS.
#
# Usage: verify-aws-identity.sh EXPECTED_ROLE_NAME [EVIDENCE_FILE]
set -euo pipefail

EXPECTED_ROLE="$1"
EVIDENCE_FILE="${2:-}"

# Environment variables and the shared credentials file both take precedence
# over instance metadata in the AWS credential chain, so either would silently
# override the instance role.
for var in AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN; do
  if [ -n "${!var:-}" ]; then
    echo "Refusing to run: $var is set. Credentials must come from the IAM role." >&2
    exit 1
  fi
done

CREDENTIALS_FILE="${AWS_SHARED_CREDENTIALS_FILE:-$HOME/.aws/credentials}"
if [ -s "$CREDENTIALS_FILE" ]; then
  echo "Refusing to run: $CREDENTIALS_FILE exists. Remove stored access keys from the Jenkins host." >&2
  exit 1
fi

IDENTITY=$(aws sts get-caller-identity --output json)
ARN=$(echo "$IDENTITY" | jq -r '.Arn')

case "$ARN" in
  arn:aws*:sts::*:assumed-role/"$EXPECTED_ROLE"/*)
    echo "AWS identity OK: $ARN"
    ;;
  *)
    echo "Unexpected AWS identity: $ARN (expected assumed-role/$EXPECTED_ROLE)" >&2
    exit 1
    ;;
esac

if [ -n "$EVIDENCE_FILE" ]; then
  mkdir -p "$(dirname "$EVIDENCE_FILE")"
  echo "$IDENTITY" > "$EVIDENCE_FILE"
fi
