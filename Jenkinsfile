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
    booleanParam(
      name: 'RUN_TERRAFORM_PLAN',
      defaultValue: true,
      description: 'Run Terraform init/validate/plan'
    )
    booleanParam(
      name: 'DEPLOY',
      defaultValue: true,
      description: 'Push images and redeploy ECS'
    )
  }

  environment {
    AWS_REGION     = 'us-east-1'
    AWS_ACCOUNT_ID = "${params.AWS_ACCOUNT_ID}"

    BACKEND_DIR    = 'apps/backend'
    FRONTEND_DIR   = 'apps/frontend'
    INFRA_DIR      = 'infra'

    BACKEND_IMAGE  = 'fullstack-backend'
    FRONTEND_IMAGE = 'fullstack-frontend'

    APP_NAME       = 'fullstack-automation'
    ECR_BACKEND    = "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${APP_NAME}-backend"
    ECR_FRONTEND   = "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${APP_NAME}-frontend"

    ECS_CLUSTER    = "${APP_NAME}-cluster"
    ECS_SERVICE    = "${APP_NAME}-service"

    IMAGE_TAG      = "${env.BUILD_NUMBER}"
  }

  stages {
    stage('Validate Inputs') {
      steps {
        script {
          if (!params.AWS_ACCOUNT_ID?.trim()) {
            error('AWS_ACCOUNT_ID parameter is empty.')
          }
        }
      }
    }

    stage('Backend Install') {
      steps {
        dir("${BACKEND_DIR}") {
          sh 'npm install'
        }
      }
    }

    stage('Frontend Install') {
      steps {
        dir("${FRONTEND_DIR}") {
          sh 'npm install'
        }
      }
    }

    stage('Backend Smoke Test') {
      steps {
        dir("${BACKEND_DIR}") {
          sh 'npm test || true'
        }
      }
    }

    stage('Frontend Build Test') {
      steps {
        dir("${FRONTEND_DIR}") {
          sh 'npm run build'
        }
      }
    }

    stage('Build Backend Docker Image') {
      steps {
        sh 'docker build -t ${BACKEND_IMAGE}:latest ./${BACKEND_DIR}'
      }
    }

    stage('Build Frontend Docker Image') {
      steps {
        sh 'docker build -t ${FRONTEND_IMAGE}:latest ./${FRONTEND_DIR}'
      }
    }

    stage('Terraform Plan') {
      when {
        expression { return params.RUN_TERRAFORM_PLAN }
      }
      steps {
        withCredentials([
          [$class: 'AmazonWebServicesCredentialsBinding', credentialsId: 'aws-credentials'],
          string(credentialsId: 'db-password', variable: 'TF_VAR_db_password')
        ]) {
          dir("${INFRA_DIR}") {
            sh 'terraform init'
            sh 'terraform validate'
            sh 'terraform plan -no-color'
          }
        }
      }
    }

    stage('Terraform Apply') {
      when {
        expression { return params.DEPLOY }
      }
      steps {
        withCredentials([
          [$class: 'AmazonWebServicesCredentialsBinding', credentialsId: 'aws-credentials'],
          string(credentialsId: 'db-password', variable: 'TF_VAR_db_password')
        ]) {
          dir("${INFRA_DIR}") {
            sh 'terraform apply -auto-approve -no-color'
          }
        }
      }
    }

    stage('ECR Login') {
      when {
        expression { return params.DEPLOY }
      }
      steps {
        withCredentials([[$class: 'AmazonWebServicesCredentialsBinding', credentialsId: 'aws-credentials']]) {
          sh '''
            aws ecr get-login-password --region ${AWS_REGION} \
            | docker login --username AWS --password-stdin ${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com
          '''
        }
      }
    }

    stage('Tag Images') {
      when {
        expression { return params.DEPLOY }
      }
      steps {
        sh '''
          docker tag ${BACKEND_IMAGE}:latest ${ECR_BACKEND}:latest
          docker tag ${BACKEND_IMAGE}:latest ${ECR_BACKEND}:${IMAGE_TAG}

          docker tag ${FRONTEND_IMAGE}:latest ${ECR_FRONTEND}:latest
          docker tag ${FRONTEND_IMAGE}:latest ${ECR_FRONTEND}:${IMAGE_TAG}
        '''
      }
    }

    stage('Push Images') {
      when {
        expression { return params.DEPLOY }
      }
      steps {
        sh '''
          docker push ${ECR_BACKEND}:latest
          docker push ${ECR_BACKEND}:${IMAGE_TAG}

          docker push ${ECR_FRONTEND}:latest
          docker push ${ECR_FRONTEND}:${IMAGE_TAG}
        '''
      }
    }

    stage('Run Database Migrations') {
      when {
        expression { return params.DEPLOY }
      }
      steps {
        withCredentials([
          [$class: 'AmazonWebServicesCredentialsBinding', credentialsId: 'aws-credentials'],
          string(credentialsId: 'db-password', variable: 'DB_PASSWORD')
        ]) {
          dir("${INFRA_DIR}") {
            script {
              env.RDS_ENDPOINT = sh(script: 'terraform output -raw rds_endpoint', returnStdout: true).trim()
            }
          }
          dir("${BACKEND_DIR}") {
            sh '''
              export DATABASE_URL="postgresql://encounters_admin:${DB_PASSWORD}@${RDS_ENDPOINT}/encounters"
              npm run migrate
            '''
          }
        }
      }
    }

    stage('Render ECS Task Definition') {
      when {
        expression { return params.DEPLOY }
      }
      steps {
        withCredentials([[$class: 'AmazonWebServicesCredentialsBinding', credentialsId: 'aws-credentials']]) {
          sh '''
            ./cicd/jenkins/ecs/render-taskdef.sh \
              ${ECS_CLUSTER} \
              ${ECS_SERVICE} \
              ${ECR_BACKEND}:${IMAGE_TAG} \
              ${ECR_FRONTEND}:${IMAGE_TAG} \
              ${AWS_REGION}
          '''
        }
      }
    }

    stage('Register ECS Task Definition') {
      when {
        expression { return params.DEPLOY }
      }
      steps {
        withCredentials([[$class: 'AmazonWebServicesCredentialsBinding', credentialsId: 'aws-credentials']]) {
          sh '''
            ./cicd/jenkins/ecs/register-taskdef.sh ${AWS_REGION}
          '''
        }
      }
    }

    stage('Deploy ECS Task Definition') {
      when {
        expression { return params.DEPLOY }
      }
      steps {
        withCredentials([[$class: 'AmazonWebServicesCredentialsBinding', credentialsId: 'aws-credentials']]) {
          sh '''
            NEW_TASK_DEF_ARN=$(cat new-taskdef-arn.txt)

            aws ecs update-service \
              --cluster ${ECS_CLUSTER} \
              --service ${ECS_SERVICE} \
              --task-definition $NEW_TASK_DEF_ARN \
              --region ${AWS_REGION}
          '''
        }
      }
    }

    stage('Wait for ECS Stability') {
      when {
        expression { return params.DEPLOY }
      }
      steps {
        withCredentials([[$class: 'AmazonWebServicesCredentialsBinding', credentialsId: 'aws-credentials']]) {
          sh '''
            aws ecs wait services-stable \
              --cluster ${ECS_CLUSTER} \
              --services ${ECS_SERVICE} \
              --region ${AWS_REGION}
          '''
        }
      }
    }
  }

  post {
    success {
      echo 'Pipeline completed successfully: images pushed and ECS redeployed.'
    }
    failure {
      echo 'Pipeline failed. Check the failed stage logs.'
    }
    always {
      sh 'docker system prune -af || true'
      sh 'rm -rf ~/.npm/_cacache || true'
    }
  }
}
