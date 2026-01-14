# Attendance Backend – Production CI/CD Deployment

## Overview

This project is a **production-ready Attendance & Payslip Backend API** built with **Node.js and Express**, deployed using a **Jenkins CI/CD pipeline** with **Docker** on **AWS EC2** behind an **Application Load Balancer**.

The repository demonstrates **real-world DevOps practices**, including secure configuration management, health-check-based deployments, and rollback-ready CI/CD pipelines.

---

## Tech Stack

* **Backend**: Node.js, Express
* **Database**: MongoDB
* **CI/CD**: Jenkins (Pipeline as Code)
* **Containerization**: Docker
* **OS**: Linux
* **Cloud**: AWS EC2
* **Scalability**: Auto Scaling Group
* **Traffic Management**: Application Load Balancer

---

## Architecture Summary

* Developers push code to GitHub
* Jenkins pipeline is triggered automatically
* Docker image is built and deployed
* Application runs on EC2 instances
* Load Balancer routes traffic only to healthy instances
* Health checks validate deployment success

---

## CI/CD Flow

```
GitHub
  ↓
Jenkins Pipeline
  ↓
Docker Build
  ↓
EC2 Instance (Auto Scaling Group)
  ↓
Application Load Balancer
  ↓
End Users
```

---

## Key Features

* Automated build and deployment using Jenkins
* Secure environment variable handling via Jenkins credentials
* Health-check-based deployment validation
* Automatic rollback on deployment failure
* Scalable backend architecture behind Load Balancer
* Background jobs for logs and birthday reminders

---

## Health Check

The backend exposes a dedicated health endpoint used by Jenkins and Load Balancer:

```
GET /health
Response: { "status": "UP" }
```

This ensures only healthy instances receive traffic.

---

## Deployment Strategy

* Docker containers are rebuilt on each deployment
* Old containers are stopped only after new deployment starts
* Health checks confirm application readiness
* Rollback script redeploys the previous stable image on failure

Detailed explanation is available in:

```
docs/deployment-strategy.md
```

---

## Security & Best Practices

* No secrets stored in the repository
* Sensitive values managed using Jenkins Credentials
* Strict CORS allowlist configuration
* Environment-based configuration for production readiness

---

## Repository Structure

```
attendance-backend/
├── app/
│   ├── routes/
│   ├── models/
│   ├── middleware/
│   ├── jobs/
│   └── server.js
├── docker/
│   └── Dockerfile
├── jenkins/
│   └── Jenkinsfile
├── scripts/
│   ├── apply.sh
│   ├── healthchecks.sh
│   └── rollback.sh
├── docs/
│   ├── architecture.png
│   └── deployment-strategy.md
└── README.md
👉 Review your **Jenkinsfile one last time**
👉 Help you **map this repo perfectly to your resume**
