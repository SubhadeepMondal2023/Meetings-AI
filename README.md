# Memoir-Ai
### The Open-Source Enterprise Meeting Intelligence Platform

![Memoir-Ai Platform Overview]

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Next.js](https://img.shields.io/badge/Next.js-15.0-black)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue)](https://www.typescriptlang.org/)
[![AWS](https://img.shields.io/badge/AWS-Serverless-orange)](https://aws.amazon.com/)
[![Status](https://img.shields.io/badge/Status-Production%20Ready-success)]()

## 📖 Executive Summary

**Memoir-Ai** is an autonomous meeting intelligence platform designed to democratize access to conversational analytics. While commercial solutions like Fireflies.ai or Otter.ai exist, they operate as "black box" SaaS products with rigid pricing and data privacy concerns. Memoir-Ai provides a transparent, open-source alternative that integrates seamlessly into existing enterprise ecosystems (Zoom, Teams, Google Meet, Slack, Jira).

By leveraging **Serverless AWS Architecture**, **Vector Semantic Search**, and **Large Language Models (LLMs)**, Memoir-Ai transforms unstructured voice data into structured, actionable business intelligence.

---

## 🎯 Vision & Problem Statement

### The Problem
Professionals spend approximately **30-50% of their time in meetings**, yet 90% of the data generated—decisions, action items, and context—is lost the moment the call ends. Existing tools are fragmented (transcription lives separately from project management), passive (users must manually search for info), and cost-prohibitive for large teams.

### The Solution
Memoir-Ai acts as an active participant in your workflow. It uses a **Split-Brain Architecture** (Next.js Frontend + AWS Lambda Scheduler) to ensure high availability and autonomous operation. It records, transcribes, understands context, and pushes data to where work actually happens.

---

## 📊 Competitive Analysis

We benchmarked Memoir-Ai against leading proprietary solutions to highlight the advantages of an open-architecture approach.

| Feature Comparison | Memoir-Ai (Open Source) | Commercial SaaS (Fireflies/Otter) |
| :--- | :--- | :--- |
| **Data Sovereignty** | **100% Self-Hosted** (You own the data) | Vendor Locked |
| **Meeting History Query** | **Global RAG** (Chat with *entire* database) | Limited / Single Meeting Context |
| **Integration Ecosystem** | **Full Write-Access** (Jira, Asana, Trello) | Read-Only or Premium-Tier Only |
| **Scalability** | **Serverless (AWS Lambda)** | Linear Cost Scaling |
| **Bot Customization** | **Full White-Labeling** (Name, Image) | Generic "Bot" Branding |
| **Cost Efficiency** | **Pay-per-use** (API costs) | Flat Monthly Subscription ($20+/user) |

---

## 🏗 System Architecture

Memoir-Ai utilizes a modern, event-driven architecture designed for high availability and low latency.

### 1. The Autonomous Scheduler (AWS Lambda)
Unlike traditional cron jobs that constantly poll servers, Memoir-Ai utilizes a serverless architecture.
* **Event Source:** Google Calendar Webhooks trigger synchronization events.
* **Execution:** AWS EventBridge schedules ephemeral **AWS Lambda** functions to wake up exactly when a meeting starts.
* **Efficiency:** Zero idle server costs and 99.9% bot attendance reliability.

### 2. The Intelligence Engine (RAG Pipeline)
* **Ingestion:** Meeting transcripts are chunked and embedded using OpenAI's `text-embedding-3-small`.
* **Storage:** Vectors are stored in **Pinecone** with metadata filtering (by user, date, or meeting type).
* **Retrieval:** The **Global Chat** feature uses a Retrieval-Augmented Generation (RAG) pipeline to answer queries like *"What did we decide about the frontend timeline last month?"* by scanning hundreds of past meetings instantly.

---

## 🚀 Key Features

### Core Meeting Intelligence
* **Universal Bot Deployment:** Automatically joins Zoom, Google Meet, and Microsoft Teams calls without manual intervention.
* **Speaker Diarization:** Advanced audio processing to distinguish between speakers and attribute text accurately.
* **Sentiment Analysis:** (Beta) Analyzes tone and sentiment per speaker to gauge meeting health.
* **Smart Summaries:** Generates concise executive summaries, key takeaways, and bulleted lists of decisions.

### Integration & Workflow Automation
* **Real-Time Calendar Sync:** Two-way synchronization with Google Calendar. Automatically detects meeting links and schedules bots.
* **Project Management Push:** One-click conversion of identified "Action Items" into live tickets in **Jira**, **Asana**, or **Trello**.
* **Native Slack Integration:** A custom Slack bot built with the Bolt framework allows users to query meeting insights directly from team channels (e.g., `@MemoirAi What was the budget for Q4?`).

### Advanced AI Capabilities
* **Global Knowledge Base (RAG):** "Chat with your data" capability that spans across years of meeting history, not just single transcripts.
* **Contextual Search:** Semantic search engine allows finding moments based on meaning rather than exact keyword matches.
* **Automated Email Follow-ups:** Uses Resend to instantly dispatch meeting minutes to all attendees post-call.

### Enterprise-Grade SaaS Features
* **Multi-Tier Subscription System:** Fully functional SaaS model with Stripe integration (Free, Starter, Pro tiers).
* **Role-Based Access Control (RBAC):** Secure authentication and session management via Clerk.
* **Webhook Security:** Implementation of Svix for cryptographic verification of incoming webhook events.
* **Dashboard & Analytics:** Comprehensive analytics regarding meeting frequency, duration, and bot usage.

---

## 🛠 Technology Stack

**Frontend & Core Application**
* **Framework:** Next.js 15 (App Router)
* **Language:** TypeScript
* **Styling:** Tailwind CSS 4, Shadcn UI
* **State Management:** React Query, Context API

**Backend & Infrastructure**
* **Serverless:** AWS Lambda (Node.js runtime)
* **Storage:** AWS S3 (Audio & Assets)
* **Scheduling:** AWS EventBridge
* **Database:** PostgreSQL (via NeonDB), Prisma ORM

**AI & Machine Learning**
* **LLM:** OpenAI GPT-4o
* **Vector DB:** Pinecone
* **Bot Infrastructure:** MeetingBaas API

**Integrations & Payment**
* **Auth:** Clerk
* **Payments:** Stripe
* **Messaging:** Slack Bolt Framework, Resend (Email)

---

## 💻 Installation & Deployment

### Prerequisites
* Node.js 18+ installed locally.
* PostgreSQL Database (Local or Cloud provider like Neon).
* AWS Account with permissions for Lambda, S3, and EventBridge.
* API Keys for OpenAI, Pinecone, Stripe, and MeetingBaas.

### 1. Local Development Setup

```bash
# Clone the repository
git clone [https://github.com/cooldude6000/memoir-ai.git](https://github.com/cooldude6000/memoir-ai.git)
cd memoir-ai

# Install dependencies
npm install

# Initialize Database Schema
npx prisma generate
npx prisma db push

# Start the development server
npm run dev
2. Environment Configuration
Create a .env file in the root directory. Refer to .env.example for the complete list of required variables.

Code snippet

# Database & Auth
DATABASE_URL="postgresql://..."
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY="pk_test_..."
CLERK_SECRET_KEY="sk_test_..."

# AI Services
OPENAI_API_KEY="sk-..."
PINECONE_API_KEY="pc-..."

# Integrations
STRIPE_SECRET_KEY="sk_test_..."
SLACK_BOT_TOKEN="xoxb-..."
MEETING_BAAS_API_KEY="mb-..."
3. Deploying the Scheduler (AWS Lambda)
To enable the autonomous bot scheduler, you must deploy the Lambda function found in /lambda-function.

Navigate to the /lambda-function directory.

Install dependencies and remove platform-specific binaries (Windows .exe) to optimize size.

Zip the folder contents (ensure .env is excluded from the zip).

Upload the zip to AWS Lambda.

Set Environment Variables in the AWS Console (Configuration -> Environment variables).

Configure AWS EventBridge to trigger the function on a schedule (e.g., every 5 minutes).

Feel free to send pr with new ideas
📄 License
This project is licensed under the MIT License - see the LICENSE file for details.

Memoir-Ai — Turning Conversations into Capital.
