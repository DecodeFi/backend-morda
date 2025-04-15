#!/bin/bash

DATE=$(date +"%Y%m%d_%H%M%S")
mkdir -p backups

pg2parquet \
  --host localhost \
  --port 5432 \
  --user admin \
  --password secret \
  --database app_db \
  --table users \
  --output backups/users_$DATE.parquet
