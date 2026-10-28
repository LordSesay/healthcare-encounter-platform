environment = "prod"

# Networking
vpc_cidr = "10.2.0.0/16"

# ECS
ecs_desired_count = 3
ecs_cpu           = "1024"
ecs_memory        = "2048"

# Auto Scaling
ecs_min_capacity = 2
ecs_max_capacity = 10

# RDS
db_instance_class      = "db.t3.medium"
db_allocated_storage   = 50
db_multi_az            = true
db_deletion_protection = true
db_backup_retention    = 30

# Logging
log_retention_days = 90

# DNS / HTTPS
domain_name  = "encounters.example.com"
enable_https = true
