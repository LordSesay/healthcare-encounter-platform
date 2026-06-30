# Jenkins on EC2 Setup Runbook

## Purpose

This runbook documents how Jenkins is hosted on an EC2 instance to act as the CI/CD control plane for the Healthcare Encounter ID Platform.

## Architecture

```text
EC2 Instance
  -> Docker Engine
     -> Jenkins Container
        - Node.js / npm
        - Docker CLI
        - AWS CLI
        - Terraform
        - jq
```

## EC2 Baseline

- AMI: Amazon Linux 2023
- Instance type: t3.medium
- Storage: 30-50 GB gp3
- Inbound access:
  - SSH 22 from admin IP only
  - Jenkins 8080 from admin IP only

## Install Docker on EC2

```bash
sudo yum update -y
sudo yum install -y docker git unzip wget jq
sudo service docker start
sudo usermod -aG docker ec2-user
```

## Build Jenkins Image

```bash
docker build -t encounter-jenkins -f cicd/jenkins/Dockerfile .
```

## Run Jenkins

```bash
docker volume create jenkins_home

docker run -d \
  --name encounter-jenkins \
  --restart unless-stopped \
  -p 8080:8080 \
  -p 50000:50000 \
  -v jenkins_home:/var/jenkins_home \
  -v /var/run/docker.sock:/var/run/docker.sock \
  encounter-jenkins
```
