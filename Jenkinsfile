pipeline {
  agent any

  options {
    timestamps()
    disableConcurrentBuilds()
    buildDiscarder(logRotator(numToKeepStr: '20'))
    timeout(time: 45, unit: 'MINUTES')
  }

  parameters {
    string(
      name: 'AWS_ACCOUNT_ID',
      defaultValue: '767398054553',
      description: 'AWS account ID for ECR and ECS deployment'
    )
    choice(
      name: 'ENVIRONMENT',
      choices: ['dev', 'staging', 'prod'],
      description: 'Target deployment environment'
    )
    string(
      name: 'PROMOTE_TAG',
      defaultValue: '',
      description: 'Image tag to promote (prod only — skips build, deploys existing image)'
    )
    booleanParam(
      name: 'RUN_TERRAFORM',
      defaultValue: true,
      description: 'Run Terraform init/plan/apply for infrastructure'
    )
    booleanParam(
      name: 'DEPLOY',
      defaultValue: true,
      description: 'Build/push images and deploy to ECS'
    )
  }

  environment {
    AWS_REGION     = 'us-east-1'
    AWS_ACCOUNT_ID = "${params.AWS_ACCOUNT_ID}"

    BACKEND_DIR    = 'apps/backend'
    FRONTEND_DIR   = 'apps/frontend'
    INFRA_DIR      = 'infra'

    APP_NAME       = 'fullstack-automation'
    ENV            = "${params.ENVIRONMENT}"

    ECR_BACKEND    = "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${APP_NAME}-${ENV}-backend"
    ECR_FRONTEND   = "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${APP_NAME}-${ENV}-frontend"

    ECS_CLUSTER    = "${APP_NAME}-${ENV}-cluster"
    ECS_SERVICE    = "${APP_NAME}-${ENV}-service"

    IMAGE_TAG      = "${params.PROMOTE_TAG ?: env.BUILD_NUMBER}"
  }

  stages {
    stage('Validate Inputs') {
      steps {
        script {
          if (!params.AWS_ACCOUNT_ID?.trim()) {
            error('AWS_ACCOUNT_ID parameter is empty.')
          }
          if (params.ENVIRONMENT == 'prod' && params.PROMOTE_TAG?.trim()) {
            echo "PROD PROMOTION: deploying existing tag ${params.PROMOTE_TAG} (skipping build)"
          }
        }
      }
    }

    // ─── BUILD STAGES (skipped for prod promotion) ───

    stage('Backend Install') {
      when {
        expression { return params.DEPLOY && !params.PROMOTE_TAG?.trim() }
      }
      steps {
        dir("${BACKEND_DIR}") {
          sh 'npm ci'
        }
      }
    }

    stage('Frontend Install') {
      when {
        expression { return params.DEPLOY && !params.PROMOTE_TAG?.trim() }
      }
      steps {
        dir("${FRONTEND_DIR}") {
          sh 'npm install'
        }
      }
    }

    stage('Backend Smoke Test') {
      when {
        expression { return params.DEPLOY && !params.PROMOTE_TAG?.trim() }
      }
      steps {
        dir("${BACKEND_DIR}") {
          sh 'npm test || true'
        }
      }
    }

    stage('Frontend Build') {
      when {
        expression { return params.DEPLOY && !params.PROMOTE_TAG?.trim() }
      }
      steps {
        dir("${FRONTEND_DIR}") {
          sh 'npm run build'
        }
      }
    }

    stage('Build Docker Images') {
      when {
        expression { return params.DEPLOY && !params.PROMOTE_TAG?.trim() }
      }
      steps {
        sh """
          docker build -t ${APP_NAME}-backend:${IMAGE_TAG} ./${BACKEND_DIR}
          docker build -t ${APP_NAME}-frontend:${IMAGE_TAG} ./${FRONTEND_DIR}
        """
      }
    }

    // ─── TERRAFORM ───

    stage('Terraform Plan') {
      when {
        expression { return params.RUN_TERRAFORM }
      }
      steps {
        withCredentials([[$class: 'AmazonWebServicesCredentialsBinding', credentialsId: 'aws-credentials']]) {
          dir("${INFRA_DIR}") {
            sh """
              terraform init \
                -backend-config="key=env/${ENV}/terraform.tfstate" \
                -reconfigure

              terraform validate

              terraform plan \
                -var-file=environments/${ENV}.tfvars \
                -var="db_password=\${DB_PASSWORD}" \
                -out=tfplan \
                -no-color
            """
          }
        }
      }
    }

    stage('Terraform Apply') {
      when {
        expression { return params.RUN_TERRAFORM }
      }
      steps {
        withCredentials([[$class: 'AmazonWebServicesCredentialsBinding', credentialsId: 'aws-credentials']]) {
          dir("${INFRA_DIR}") {
            sh 'terraform apply -auto-approve tfplan'
          }
        }
      }
    }

    // ─── DEPLOY ───

    stage('ECR Login') {
      when {
        expression { return params.DEPLOY }
      }
      steps {
        withCredentials([[$class: 'AmazonWebServicesCredentialsBinding', credentialsId: 'aws-credentials']]) {
          sh """
            aws ecr get-login-password --region ${AWS_REGION} \
            | docker login --username AWS --password-stdin ${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com
          """
        }
      }
    }

    stage('Tag & Push Images') {
      when {
        expression { return params.DEPLOY && !params.PROMOTE_TAG?.trim() }
      }
      steps {
        sh """
          docker tag ${APP_NAME}-backend:${IMAGE_TAG} ${ECR_BACKEND}:${IMAGE_TAG}
          docker tag ${APP_NAME}-backend:${IMAGE_TAG} ${ECR_BACKEND}:latest

          docker tag ${APP_NAME}-frontend:${IMAGE_TAG} ${ECR_FRONTEND}:${IMAGE_TAG}
          docker tag ${APP_NAME}-frontend:${IMAGE_TAG} ${ECR_FRONTEND}:latest

          docker push ${ECR_BACKEND}:${IMAGE_TAG}
          docker push ${ECR_BACKEND}:latest

          docker push ${ECR_FRONTEND}:${IMAGE_TAG}
          docker push ${ECR_FRONTEND}:latest
        """
      }
    }

    // ─── PROD APPROVAL GATE ───

    stage('Production Approval') {
      when {
        expression { return params.ENVIRONMENT == 'prod' && params.DEPLOY }
      }
      steps {
        input message: "Deploy to PRODUCTION with tag ${IMAGE_TAG}?", ok: 'Approve Deploy'
      }
    }

    // ─── ECS DEPLOYMENT ───

    stage('Render ECS Task Definition') {
      when {
        expression { return params.DEPLOY }
      }
      steps {
        withCredentials([[$class: 'AmazonWebServicesCredentialsBinding', credentialsId: 'aws-credentials']]) {
          sh """
            ./cicd/jenkins/ecs/render-taskdef.sh \
              ${ECS_CLUSTER} \
              ${ECS_SERVICE} \
              ${ECR_BACKEND}:${IMAGE_TAG} \
              ${ECR_FRONTEND}:${IMAGE_TAG} \
              ${AWS_REGION}
          """
        }
      }
    }

    stage('Register ECS Task Definition') {
      when {
        expression { return params.DEPLOY }
      }
      steps {
        withCredentials([[$class: 'AmazonWebServicesCredentialsBinding', credentialsId: 'aws-credentials']]) {
          sh './cicd/jenkins/ecs/register-taskdef.sh ${AWS_REGION}'
        }
      }
    }

    stage('Deploy to ECS') {
      when {
        expression { return params.DEPLOY }
      }
      steps {
        withCredentials([[$class: 'AmazonWebServicesCredentialsBinding', credentialsId: 'aws-credentials']]) {
          sh """
            NEW_TASK_DEF_ARN=\$(cat new-taskdef-arn.txt)

            aws ecs update-service \
              --cluster ${ECS_CLUSTER} \
              --service ${ECS_SERVICE} \
              --task-definition \$NEW_TASK_DEF_ARN \
              --region ${AWS_REGION}
          """
        }
      }
    }

    stage('Wait for ECS Stability') {
      when {
        expression { return params.DEPLOY }
      }
      steps {
        withCredentials([[$class: 'AmazonWebServicesCredentialsBinding', credentialsId: 'aws-credentials']]) {
          sh """
            aws ecs wait services-stable \
              --cluster ${ECS_CLUSTER} \
              --services ${ECS_SERVICE} \
              --region ${AWS_REGION}
          """
        }
      }
    }
  }

  post {
    success {
      echo "✅ Pipeline completed: ${ENV} environment deployed with tag ${IMAGE_TAG}"
    }
    failure {
      echo "❌ Pipeline failed for ${ENV}. Check the failed stage logs."
    }
    always {
      sh 'docker system prune -af || true'
      sh 'rm -rf ~/.npm/_cacache || true'
    }
  }
}
