## 🏗️ Backend Architecture & CI/CD Overview

![Image](https://miro.medium.com/v2/resize%3Afit%3A1015/1%2ArlPRYAfJ_aFOfoj52U7y2A.png)

![Image](https://media.licdn.com/dms/image/v2/D4D12AQE_fQ78r-RH_A/article-cover_image-shrink_720_1280/article-cover_image-shrink_720_1280/0/1709930101321?e=2147483647\&t=guRsl5tHb1T0XM9_rxmNbCPBXiMJ9PIZGpoTzfnp8KE\&v=beta)

![Image](https://d2908q01vomqb2.cloudfront.net/7719a1c782a1ba91c031a682a0a2f8658209adbf/2022/06/09/img1.png)

---

# 🚀 Attendance Backend

### Production CI/CD • Dockerized • Cloud-Ready

A **production-ready Attendance & Payslip Backend API** built with **Node.js and Express**, deployed using a **Jenkins CI/CD pipeline** with **Docker** on a Linux server (AWS EC2).
This project demonstrates **real-world backend deployment and DevOps practices**, not just API development.

---

## ✨ Key Highlights

* ⚙️ Jenkins CI/CD (Pipeline as Code)
* 🐳 Dockerized backend deployment
* 🔐 Secure environment configuration
* ❤️ Health-check-based deployment validation
* 🔄 Automatic rollback on failure
* 📈 Scalable backend architecture
* 🧠 Designed with production mindset

---

## 🛠 Tech Stack

| Layer            | Technology                |
| ---------------- | ------------------------- |
| Backend          | Node.js, Express          |
| Database         | MongoDB                   |
| CI/CD            | Jenkins                   |
| Containerization | Docker                    |
| OS               | Linux                     |
| Cloud            | AWS EC2                   |
| Traffic          | Application Load Balancer |
| Scaling          | Auto Scaling Group        |

---

## 🧱 Architecture Summary

* Developers push backend code to GitHub
* Jenkins pipeline is triggered automatically
* Docker image is built and deployed
* Backend runs on EC2 instances
* Load Balancer routes traffic only to healthy instances

```
Developer → GitHub → Jenkins → Docker → EC2 (ASG) → Load Balancer → Clients
```

---

## 🔁 CI/CD Pipeline Flow

1. Checkout backend source code
2. Build Docker image
3. Deploy container on EC2
4. Run health check validation
5. Roll back automatically if deployment fails

This ensures **safe, repeatable, and reliable deployments**.

---

## 🚀 Deployment Details

* Backend runs inside a Docker container
* Jenkins handles build, deploy, and validation
* Application is exposed via Load Balancer
* No manual server intervention required

---

## ❤️ Health Check Endpoint

The backend exposes a dedicated health endpoint used by Jenkins and Load Balancer:

```
GET /health
Response:
{
  "status": "UP"
}
```

This guarantees:

* Application is running
* Database connection is healthy
* Instance is safe to receive traffic

---

## 🔄 Rollback Strategy

If a deployment fails:

* Jenkins automatically triggers rollback
* Previous stable Docker image is redeployed
* Traffic continues via healthy instances

This mirrors **real production safety mechanisms**.

---

## 🔐 Security & Best Practices

* No secrets stored in the repository
* Sensitive values managed using Jenkins Credentials
* Environment-based configuration
* Strict CORS allowlist implementation
* Centralized global error handling

---

## 📁 Repository Structure

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
```

---

## 📌 Background Jobs

* Log archival automation
* Birthday reminder job
* Jobs start only after successful database connection

This reflects **enterprise-level backend design**.

---

## 🎯 Why This Project

This repository was built to demonstrate:

* Production-grade backend deployment
* CI/CD ownership with Jenkins
* Docker-based backend operations
* Health-driven deployments and rollback safety

It forms the **backend half of a complete full-stack DevOps solution**.

You’ve built a **solid, professional DevOps portfolio** 💪
