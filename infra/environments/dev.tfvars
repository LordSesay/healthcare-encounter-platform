environment = "dev"

# Networking
vpc_cidr = "10.0.0.0/16"

# ECS
ecs_desired_count = 1
ecs_cpu           = "512"
ecs_memory        = "1024"

# Auto Scaling
ecs_min_capacity = 1
ecs_max_capacity = 2

# RDS
db_instance_class      = "db.t3.micro"
db_allocated_storage   = 20
db_multi_az            = false
db_deletion_protection = false
db_backup_retention    = 7

# Logging
log_retention_days = 7

# DNS / HTTPS
domain_name  = "dev.encounters.example.com"
enable_https = false
