environment = "staging"

# Networking
vpc_cidr = "10.1.0.0/16"

# ECS
ecs_desired_count = 2
ecs_cpu           = "1024"
ecs_memory        = "2048"

# Auto Scaling
ecs_min_capacity = 1
ecs_max_capacity = 4

# RDS
db_instance_class      = "db.t3.small"
db_allocated_storage   = 30
db_multi_az            = false
db_deletion_protection = false
db_backup_retention    = 14

# Logging
log_retention_days = 14

# DNS / HTTPS
domain_name  = "staging.encounters.example.com"
enable_https = true
