# Deployment Strategy – Attendance Backend

## CI/CD Tool
Jenkins (Pipeline as Code)

## Deployment Flow
1. Code push to GitHub
2. Jenkins pipeline triggered
3. Docker image built
4. Application deployed using shell scripts
5. Health checks executed
6. Rollback triggered automatically on failure

## Security
- Secrets managed using Jenkins Credentials
- No sensitive data stored in repository

## Zero Downtime
- Container replacement behind Load Balancer
- Traffic routed only to healthy instances
