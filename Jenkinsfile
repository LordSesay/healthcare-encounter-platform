pipeline {
  agent any

  options {
    timestamps()
    disableConcurrentBuilds()
    buildDiscarder(logRotator(numToKeepStr: '20'))
    timeout(time: 60, unit: 'MINUTES')
  }

  parameters {
    string(
      name: 'AWS_ACCOUNT_ID',
      defaultValue: '',
      description: 'AWS account ID (auto-detected if empty)'
    )
    choice(
      name: 'ENVIRONMENT',
      choices: ['dev', 'staging', 'prod'],
      description: 'Target deployment environment'
    )
    string(
      name: 'PROMOTE_TAG',
      defaultValue: '',
      description: 'Existing image tag in the TARGET environment repositories to redeploy (skips build; tests still run)'
    )
    booleanParam(
      name: 'DEPLOY',
      defaultValue: true,
      description: 'Push images and deploy to ECS after tests pass'
    )
  }

  // Only constants here: declarative `environment` values cannot be
  // overridden later with env.X, so derived values are set in 'Resolve Release'.
  environment {
    AWS_REGION   = 'us-east-1'
    BACKEND_DIR  = 'apps/backend'
    FRONTEND_DIR = 'apps/frontend'
    APP_NAME     = 'encounter-platform'
    ENV          = "${params.ENVIRONMENT}"
  }

  stages {

    // ── ALWAYS: resolve account and immutable release identity ──────────────

    stage('Resolve Release') {
      steps {
        withCredentials([[$class: 'AmazonWebServicesCredentialsBinding', credentialsId: 'aws-credentials']]) {
          script {
            def account = params.AWS_ACCOUNT_ID?.trim() ?:
              sh(script: 'aws sts get-caller-identity --query Account --output text', returnStdout: true).trim()
            def commit = sh(script: 'git rev-parse --short=12 HEAD', returnStdout: true).trim()
            def registry = "${account}.dkr.ecr.${env.AWS_REGION}.amazonaws.com"

            env.AWS_ACCOUNT_ID = account
            env.GIT_SHA        = commit
            env.IMAGE_TAG      = params.PROMOTE_TAG?.trim() ?: "${commit}-b${env.BUILD_NUMBER}"
            env.ECR_BACKEND    = "${registry}/${env.APP_NAME}-${env.ENV}-backend"
            env.ECR_FRONTEND   = "${registry}/${env.APP_NAME}-${env.ENV}-frontend"
            env.ECS_CLUSTER    = "${env.APP_NAME}-${env.ENV}-cluster"
            env.ECS_SERVICE    = "${env.APP_NAME}-${env.ENV}-service"
            env.ALB_NAME       = "${env.APP_NAME}-${env.ENV}-alb"
            env.M2M_SECRET_ID  = "${env.APP_NAME}/${env.ENV}/m2m-client"
            env.EVIDENCE_DIR   = "docs/evidence/jenkins-${env.ENV}-build-${env.BUILD_NUMBER}"

            if (env.IMAGE_TAG == 'latest') {
              error('IMAGE_TAG must be immutable; latest is not allowed')
            }
            echo "Account: ${env.AWS_ACCOUNT_ID} | Env: ${env.ENV} | Commit: ${env.GIT_SHA} | Tag: ${env.IMAGE_TAG}"
          }
          sh '''
            mkdir -p "$EVIDENCE_DIR"
            jq -n --arg commit "$(git rev-parse HEAD)" --arg tag "$IMAGE_TAG" --arg env "$ENV" \
              --arg build "$BUILD_NUMBER" --arg url "$BUILD_URL" --arg account "$AWS_ACCOUNT_ID" \
              '{commit:$commit, image_tag:$tag, environment:$env, jenkins_build:$build, jenkins_url:$url, account:$account}' \
              > "$EVIDENCE_DIR/release.json"
          '''
        }
      }
    }

    // ── ALWAYS: tests run regardless of DEPLOY flag ──────────────────────────

    stage('Backend Install') {
      steps {
        dir("${BACKEND_DIR}") { sh 'npm ci' }
      }
    }

    stage('Backend Unit Tests') {
      steps {
        dir("${BACKEND_DIR}") { sh 'npm test -- --runInBand' }
      }
    }

    stage('Backend Integration Tests') {
      steps {
        withCredentials([string(credentialsId: 'test-database-url', variable: 'TEST_DATABASE_URL')]) {
          dir("${BACKEND_DIR}") {
            sh '''
              export TZ=UTC
              export TEST_DB_TIMEZONE=UTC
              npm run test:integration
            '''
          }
        }
      }
    }

    stage('Backend Audit') {
      steps {
        dir("${BACKEND_DIR}") { sh 'npm audit --omit=dev --audit-level=high' }
      }
    }

    stage('Frontend Install & Test') {
      steps {
        dir("${FRONTEND_DIR}") {
          sh 'npm ci'
          sh 'CI=true npm test -- --watchAll=false'
        }
      }
    }

    stage('Frontend Build') {
      when {
        expression { return !params.PROMOTE_TAG?.trim() }
      }
      steps {
        dir("${FRONTEND_DIR}") { sh 'npm run build' }
      }
    }

    // ── BUILD: skipped for promotion ─────────────────────────────────────────

    stage('Build Docker Images') {
      when {
        expression { return params.DEPLOY && !params.PROMOTE_TAG?.trim() }
      }
      steps {
        sh '''
          docker build --pull -t "$ECR_BACKEND:$IMAGE_TAG" "./$BACKEND_DIR"
          docker build --pull -t "$ECR_FRONTEND:$IMAGE_TAG" "./$FRONTEND_DIR"
        '''
      }
    }

    // ── DEPLOY ───────────────────────────────────────────────────────────────

    stage('ECR Login') {
      when {
        expression { return params.DEPLOY }
      }
      steps {
        withCredentials([[$class: 'AmazonWebServicesCredentialsBinding', credentialsId: 'aws-credentials']]) {
          sh '''
            aws ecr get-login-password --region "$AWS_REGION" \
            | docker login --username AWS --password-stdin "$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"
          '''
        }
      }
    }

    stage('Push Images') {
      when {
        expression { return params.DEPLOY && !params.PROMOTE_TAG?.trim() }
      }
      steps {
        // Repositories are IMMUTABLE: only the unique release tag is pushed.
        sh '''
          docker push "$ECR_BACKEND:$IMAGE_TAG"
          docker push "$ECR_FRONTEND:$IMAGE_TAG"
        '''
      }
    }

    stage('Record Image Digests') {
      when {
        expression { return params.DEPLOY }
      }
      steps {
        withCredentials([[$class: 'AmazonWebServicesCredentialsBinding', credentialsId: 'aws-credentials']]) {
          // Also proves a promoted tag exists in this environment's repositories.
          sh '''
            for repo in backend frontend; do
              aws ecr describe-images --region "$AWS_REGION" \
                --repository-name "$APP_NAME-$ENV-$repo" --image-ids imageTag="$IMAGE_TAG" \
                --query 'imageDetails[0].{repository:repositoryName,digest:imageDigest,tags:imageTags,pushedAt:imagePushedAt}' \
                > "$EVIDENCE_DIR/image-$repo.json"
            done
          '''
        }
      }
    }

    stage('Production Approval') {
      when {
        expression { return params.ENVIRONMENT == 'prod' && params.DEPLOY }
      }
      steps {
        input message: "Deploy tag ${env.IMAGE_TAG} to PRODUCTION?", ok: 'Approve Deploy'
      }
    }

    stage('Register ECS Task Definition') {
      when {
        expression { return params.DEPLOY }
      }
      steps {
        withCredentials([[$class: 'AmazonWebServicesCredentialsBinding', credentialsId: 'aws-credentials']]) {
          sh '''
            ./cicd/jenkins/ecs/render-taskdef.sh "$ECS_CLUSTER" "$ECS_SERVICE" \
              "$ECR_BACKEND:$IMAGE_TAG" "$ECR_FRONTEND:$IMAGE_TAG" "$AWS_REGION" "$IMAGE_TAG"
            ./cicd/jenkins/ecs/register-taskdef.sh "$AWS_REGION"
            cp new-taskdef-arn.txt "$EVIDENCE_DIR/taskdef-arn.txt"
          '''
        }
      }
    }

    stage('Run Migrations') {
      when {
        expression { return params.DEPLOY }
      }
      steps {
        withCredentials([[$class: 'AmazonWebServicesCredentialsBinding', credentialsId: 'aws-credentials']]) {
          sh '''
            NETWORK=$(aws ecs describe-services --cluster "$ECS_CLUSTER" --services "$ECS_SERVICE" --region "$AWS_REGION" \
              --query 'services[0].networkConfiguration.awsvpcConfiguration' --output json)
            ./cicd/jenkins/ecs/run-migration.sh "$ECS_CLUSTER" "$(cat new-taskdef-arn.txt)" \
              "$(echo "$NETWORK" | jq -r '.subnets | join(",")')" \
              "$(echo "$NETWORK" | jq -r '.securityGroups | join(",")')" \
              "$AWS_REGION" "$EVIDENCE_DIR"
          '''
        }
      }
    }

    stage('Deploy to ECS') {
      when {
        expression { return params.DEPLOY }
      }
      steps {
        withCredentials([[$class: 'AmazonWebServicesCredentialsBinding', credentialsId: 'aws-credentials']]) {
          sh '''
            aws ecs update-service --cluster "$ECS_CLUSTER" --service "$ECS_SERVICE" \
              --task-definition "$(cat new-taskdef-arn.txt)" --region "$AWS_REGION" > /dev/null
            aws ecs wait services-stable --cluster "$ECS_CLUSTER" --services "$ECS_SERVICE" --region "$AWS_REGION"
          '''
        }
      }
    }

    // ── VERIFY: functional smoke test against the live ALB ───────────────────

    stage('Post-Deploy Smoke Test') {
      when {
        expression { return params.DEPLOY }
      }
      steps {
        withCredentials([[$class: 'AmazonWebServicesCredentialsBinding', credentialsId: 'aws-credentials']]) {
          sh '''
            ALB_DNS=$(aws elbv2 describe-load-balancers --names "$ALB_NAME" --region "$AWS_REGION" \
              --query 'LoadBalancers[0].DNSName' --output text)
            BASE_URL="http://$ALB_DNS" RUN_ID="jenkins-$ENV-$BUILD_NUMBER" \
              EVIDENCE_DIR="$EVIDENCE_DIR/smoke" ./cicd/smoke/smoke.sh

            aws ecs describe-services --cluster "$ECS_CLUSTER" --services "$ECS_SERVICE" --region "$AWS_REGION" \
              --query 'services[0].{status:status,runningCount:runningCount,taskDefinition:taskDefinition,deployments:deployments}' \
              > "$EVIDENCE_DIR/ecs-service.json"
          '''
        }
      }
    }
  }

  post {
    always {
      archiveArtifacts artifacts: "${env.EVIDENCE_DIR ?: 'docs/evidence'}/**", allowEmptyArchive: true, fingerprint: true
      // Remove only this build's images; never prune the shared agent.
      sh '''
        [ -n "${IMAGE_TAG:-}" ] || exit 0
        docker image rm "$ECR_BACKEND:$IMAGE_TAG" "$ECR_FRONTEND:$IMAGE_TAG" 2>/dev/null || true
      '''
    }
    success {
      echo "Pipeline passed: ${env.ENV} deployed with tag ${env.IMAGE_TAG}"
    }
    failure {
      echo "Pipeline failed for ${env.ENV}. Check the failed stage logs and archived evidence."
    }
  }
}
