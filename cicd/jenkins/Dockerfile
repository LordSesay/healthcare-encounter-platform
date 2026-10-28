FROM jenkins/jenkins:lts-jdk21

USER root

# Core utilities
RUN apt-get update && apt-get install -y \
    curl \
    gnupg \
    ca-certificates \
    lsb-release \
    unzip \
    wget \
    jq \
    git \
    postgresql-client \
    && rm -rf /var/lib/apt/lists/*

# Docker CLI + buildx (daemon runs on the host via socket mount). BuildKit is
# required for ADD --checksum/--chmod in apps/backend/Dockerfile.
RUN curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /usr/share/keyrings/docker.gpg \
    && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/docker.gpg] https://download.docker.com/linux/debian $(lsb_release -cs) stable" \
    > /etc/apt/sources.list.d/docker.list \
    && apt-get update \
    && apt-get install -y docker-ce-cli docker-buildx-plugin \
    && rm -rf /var/lib/apt/lists/*

# Node.js 24 LTS (Node 20 reached end of life on 2026-04-30)
RUN curl -fsSL https://deb.nodesource.com/setup_24.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# AWS CLI v2
RUN curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o awscliv2.zip \
    && unzip -q awscliv2.zip \
    && ./aws/install \
    && rm -rf aws awscliv2.zip

# Terraform 1.10.5
RUN wget -q https://releases.hashicorp.com/terraform/1.10.5/terraform_1.10.5_linux_amd64.zip \
    && unzip -q terraform_1.10.5_linux_amd64.zip \
    && mv terraform /usr/local/bin/ \
    && rm terraform_1.10.5_linux_amd64.zip

USER jenkins

# Install plugins — let jenkins-plugin-cli resolve compatible versions automatically
COPY plugins.txt /usr/share/jenkins/ref/plugins.txt
RUN jenkins-plugin-cli \
    --plugin-file /usr/share/jenkins/ref/plugins.txt \
    --latest true

# Copy init scripts — run automatically on every Jenkins boot
COPY init.groovy.d/ /usr/share/jenkins/ref/init.groovy.d/
