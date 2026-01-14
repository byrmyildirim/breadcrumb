#!/bin/sh
# wait-for-db.sh - Wait for database to be ready before running Prisma commands

MAX_RETRIES=10
RETRY_INTERVAL=5
COUNTER=0

echo "Waiting for database to be ready..."

while [ $COUNTER -lt $MAX_RETRIES ]; do
  # Try to run prisma db push
  npx prisma db push --skip-generate 2>&1
  RESULT=$?
  
  if [ $RESULT -eq 0 ]; then
    echo "Database is ready! Starting application..."
    exec npm run start
    exit 0
  fi
  
  COUNTER=$((COUNTER + 1))
  echo "Attempt $COUNTER/$MAX_RETRIES failed. Retrying in ${RETRY_INTERVAL}s..."
  sleep $RETRY_INTERVAL
done

echo "ERROR: Could not connect to database after $MAX_RETRIES attempts"
exit 1
