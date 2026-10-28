# Jenkins on EC2 Setup

Jenkins runs as a Docker container on an EC2 instance. This is the authoritative setup guide.

## Architecture

```
EC2 (t3.medium, Amazon Linux 2023 or Ubuntu 22.04)
  └── Docker Engine
        ├── jenkins-encounter-ci   (Jenkins + Node 20 + AWS CLI + Terraform + Docker CLI)
        └── jenkins-test-db        (PostgreSQL 15 — integration test sidecar)
```

Jenkins talks to the host Docker daemon via socket mount. No Docker-in-Docker.

---

## 1. Launch the EC2 Instance

- AMI: Amazon Linux 2023 (recommended) or Ubuntu 22.04
- Type: t3.medium (2 vCPU, 4 GB RAM minimum)
- Storage: 30 GB gp3
- IAM instance profile: attach the `jenkins-encounter-platform-ci` role (so AWS CLI inside the container inherits credentials automatically — no access keys stored on disk)
- Security group inbound:
  - TCP 22 from your IP only
  - TCP 8080 from your IP only

---

## 2. Install Docker

SSH into the instance, then:

**Amazon Linux 2023:**
```bash
sudo dnf update -y
sudo dnf install -y docker git
sudo systemctl enable --now docker
sudo usermod -aG docker ec2-user
newgrp docker
```

**Ubuntu 22.04:**
```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo usermod -aG docker $USER
newgrp docker
```

Verify:
```bash
docker info
```

---

## 3. Clone the Repo

```bash
git clone https://github.com/<your-username>/healthcare-encounter-platform.git
cd healthcare-encounter-platform
```

---

## 4. Create the .env File

The `docker-compose.yml` requires three env vars. Store them in a `.env` file next to it so they persist across sessions:

```bash
cd cicd/jenkins

DOCKER_GID=$(getent group docker | cut -d: -f3)
PUBLIC_IP=$(curl -sf http://169.254.169.254/latest/meta-data/public-ipv4)

cat > .env <<EOF
JENKINS_ADMIN_PASSWORD=<choose-a-strong-password>
DOCKER_GID=${DOCKER_GID}
JENKINS_URL=http://${PUBLIC_IP}:8080/
EOF

chmod 600 .env
```

> `.env` is gitignored — never commit it.

---

## 5. Build and Start

```bash
docker compose up --build -d
```

Watch startup logs:
```bash
docker compose logs -f jenkins
```

Wait for both lines:
```
==> Security configured. Admin user created.
Jenkins is fully up and running
```

Log in at `http://<public-ip>:8080` with username `admin` and the password you set.

---

## 6. Configure Jenkins Credentials

Go to **Manage Jenkins → Credentials → System → Global credentials → Add Credential**.

| ID | Type | Value |
|----|------|-------|
| `aws-credentials` | AWS Credentials | IAM access key + secret for `jenkins-encounter-platform-ci` (skip if using instance profile) |
| `db-password` | Secret text | RDS database password — must match `TF_VAR_db_password` used in Terraform |
| `test-database-url` | Secret text | `postgresql://postgres:testpass@test-db:5432/encounter_test` |

---

## 7. Create the Pipelines

### App pipeline

1. New Item → Pipeline → name it `encounter-platform-app`
2. Pipeline → Definition: **Pipeline script from SCM**
3. SCM: Git, repo URL, branch `main`
4. Script Path: `Jenkinsfile`

### Infrastructure pipeline

1. New Item → Pipeline → name it `encounter-platform-infra`
2. Same SCM config
3. Script Path: `Jenkinsfile.infra`

---

## Verify Docker Access

```bash
docker exec jenkins-encounter-ci docker ps
```

If you get a permission error, the GID didn't match. Check the actual socket GID:
```bash
ls -la /var/run/docker.sock
# srw-rw---- 1 root docker 0 ... /var/run/docker.sock
#                   ^^^^^^ this group's GID is what you need
```

Update `.env` with the correct `DOCKER_GID` and rebuild:
```bash
docker compose up --build -d
```

---

## Teardown

```bash
# Stop containers, keep jenkins_home volume (config and job history preserved)
docker compose down

# Full reset — destroys all Jenkins data
docker compose down -v
```
