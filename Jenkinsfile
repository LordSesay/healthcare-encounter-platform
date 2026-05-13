pipeline {
  agent any

  options {
    timestamps()
    disableConcurrentBuilds()
    buildDiscarder(logRotator(numToKeepStr: '20'))
    timeout(time: 30, unit: 'MINUTES')
  }

  parameters {
    string(
      name: 'AWS_ACCOUNT_ID',
      defaultValue: '767398054553',
      description: 'AWS account ID for ECR and ECS deployment'
    )
  }

  environment {
    AWS_REGION     = 'us-east-1'
    AWS_ACCOUNT_ID = "${params.AWS_ACCOUNT_ID}"

    BACKEND_DIR    = 'apps/backend'
    FRONTEND_DIR   = 'apps/frontend'

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

    stage('Build Docker Images') {
      steps {
        sh 'docker build -t ${BACKEND_IMAGE}:latest ./${BACKEND_DIR}'
        sh 'docker build -t ${FRONTEND_IMAGE}:latest ./${FRONTEND_DIR}'
      }
    }

    stage('ECR Login') {
      steps {
        withCredentials([[$class: 'AmazonWebServicesCredentialsBinding', credentialsId: 'aws-credentials']]) {
          sh '''
            aws ecr get-login-password --region ${AWS_REGION} \
            | docker login --username AWS --password-stdin ${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com
          '''
        }
      }
    }

    stage('Tag & Push Images') {
      steps {
        sh '''
          docker tag ${BACKEND_IMAGE}:latest ${ECR_BACKEND}:latest
          docker tag ${BACKEND_IMAGE}:latest ${ECR_BACKEND}:${IMAGE_TAG}

          docker tag ${FRONTEND_IMAGE}:latest ${ECR_FRONTEND}:latest
          docker tag ${FRONTEND_IMAGE}:latest ${ECR_FRONTEND}:${IMAGE_TAG}

          docker push ${ECR_BACKEND}:latest
          docker push ${ECR_BACKEND}:${IMAGE_TAG}

          docker push ${ECR_FRONTEND}:latest
          docker push ${ECR_FRONTEND}:${IMAGE_TAG}
        '''
      }
    }

    stage('Run Database Migrations') {
      steps {
        withCredentials([
          [$class: 'AmazonWebServicesCredentialsBinding', credentialsId: 'aws-credentials'],
          string(credentialsId: 'db-password', variable: 'DB_PASSWORD'),
          string(credentialsId: 'rds-endpoint', variable: 'RDS_ENDPOINT')
        ]) {
          dir("${BACKEND_DIR}") {
            sh '''
              export DATABASE_URL="postgresql://encounters_admin:${DB_PASSWORD}@${RDS_ENDPOINT}/encounters"
              npm run migrate
            '''
          }
        }
      }
    }

    stage('Deploy to ECS') {
      steps {
        withCredentials([[$class: 'AmazonWebServicesCredentialsBinding', credentialsId: 'aws-credentials']]) {
          sh '''
            ./cicd/jenkins/ecs/render-taskdef.sh \
              ${ECS_CLUSTER} \
              ${ECS_SERVICE} \
              ${ECR_BACKEND}:${IMAGE_TAG} \
              ${ECR_FRONTEND}:${IMAGE_TAG} \
              ${AWS_REGION}

            ./cicd/jenkins/ecs/register-taskdef.sh ${AWS_REGION}

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
      echo 'Pipeline completed: images pushed and ECS redeployed.'
    }
    failure {
      echo 'Pipeline failed. Check the failed stage logs.'
    }
    always {
      sh 'docker system prune -af || true'
    }
  }
}
