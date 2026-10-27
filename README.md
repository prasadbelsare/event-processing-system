# 📦 Asynchronous Event Processing System

![Node.js](https://img.shields.io/badge/node-22-brightgreen)
![TypeScript](https://img.shields.io/badge/typescript-5-blue)
![RabbitMQ](https://img.shields.io/badge/rabbitmq-3-orange)
![PostgreSQL](https://img.shields.io/badge/postgresql-16-blue)
![Docker](https://img.shields.io/badge/docker-compose-2496ED)

> **A fault-tolerant event pipeline built for high-volume logistics traffic, where slow or failing processing never slows down the API.**

This project demonstrates a robust implementation of **asynchronous event processing** for a logistics platform (package scans, status changes, hub-to-hub moves). An Express API validates events and hands them to **RabbitMQ**; independent **workers** process them into **PostgreSQL** with **retry backoff**, a **dead-letter queue**, and **idempotent, order-independent writes**. Every failure mode is covered by an automated test script.

---

## 🌟 Key Features

- **Decoupled Ingestion**: The API replies `202 Accepted` only after RabbitMQ confirms it stored the message (publisher confirms), so an accepted event is never silently lost.
- **Retry with Staged Backoff**: Transient failures go through TTL delay queues (5s, 15s, 30s) and return to the main queue automatically. No timers in application code.
- **Dead Letter Queue**: Malformed messages and events that exhaust their retries land in `events.dlq` with their attempt count preserved, for inspection.
- **Error Classification**: Permanent errors (bad JSON, schema violations) skip retries; transient errors (DB timeouts, connection refused) are retried.
- **Idempotent Processing**: `event_id` is a primary key with `ON CONFLICT DO NOTHING`, so duplicate deliveries have no effect.
- **Order-Independent State**: The current package status updates only if the event's `occurredAt` is newer (last-write-wins by event time, not arrival time).
- **Failure Simulation**: Scripts that kill workers, stop the database, shuffle arrival order, and flood duplicates, then check the final data.

---

## 🏗️ System Architecture

```mermaid
graph TD
    Client[Client / Scanner / Simulator] -->|POST /events| API[Express API]
    subgraph "Ingestion Layer"
        API --> V{Valid event?}
        V -- No --> R400[400 Bad Request]
        V -- Yes --> PUB[Publish with confirm]
    end
    PUB -->|persistent message| MAIN[(events.main)]
    PUB -->|202 Accepted| Client
    subgraph "Processing Layer"
        MAIN --> W[Worker 1..N]
        W -->|single transaction| PG[(PostgreSQL)]
    end
    W -- transient error --> RETRY[(events.retry 5s / 15s / 30s)]
    RETRY -- TTL expires --> MAIN
    W -- permanent error or 4 failed attempts --> DLQ[(events.dlq)]
```

### Failure handling

| Failure type | Examples | What happens |
|:---|:---|:---|
| **Permanent** | Malformed JSON, schema validation failure | Straight to `events.dlq`, no retries |
| **Transient** | DB connection refused, timeout | Retry via delay queues (5s, 15s, 30s), counted by an `x-attempt` header |
| **Retries exhausted** | Outage longer than the retry window | After 4 attempts, moved to `events.dlq` |
| **Worker crash** | Process killed mid-job | Message was never acked, so RabbitMQ redelivers it |

---

## 📋 Requirements

### Functional Requirements

1. **Event Ingestion**: Accept `PACKAGE_SCANNED`, `STATUS_CHANGED`, and `DELIVERY_MOVED` events over HTTP and reject invalid ones with `400`.
2. **Asynchronous Processing**: Process events in background workers, independent of the request path.
3. **Retry and Dead-Lettering**: Retry transient failures with backoff; route permanent failures to a DLQ.
4. **Package State Tracking**: Keep a full event history and the current status and location per package.
5. **Failure Simulation**: Provide repeatable scripts for worker crashes, database outages, malformed events, and out-of-order delivery.

### Non-Functional Requirements

1. **Durability**: Accepted events survive a broker restart (durable queues, persistent messages, publisher confirms).
2. **At-Least-Once Delivery**: Messages are acked only after the database commit; duplicates are expected and harmless.
3. **Idempotency**: Processing the same event any number of times leaves the database unchanged.
4. **Concurrency Safety**: Multiple workers can process events for the same package without corrupting state.
5. **Horizontal Scalability**: Add workers to share load; each holds at most 10 unacked messages (`prefetch`).

---

## 💾 Data Model

### PostgreSQL

| Table | Purpose | Key columns |
|:---|:---|:---|
| `package_events` | Append-only history of every event | `event_id` (**PK**, gives idempotency), `package_id`, `event_type`, `occurred_at`, `payload` (JSONB), `received_at` |
| `packages` | Current state per package | `package_id` (**PK**), `current_status`, `current_location`, `last_event_at` |

No foreign key links the two tables on purpose: an event can arrive before the package has been seen, and out-of-order delivery is tolerated, not rejected.

### RabbitMQ Topology

| Name | Type | Description |
|:---|:---|:---|
| `events.main` | Queue (durable) | Workers consume from here. Rejected messages dead-letter to `events.dlq`. |
| `events.retry.5s` / `15s` / `30s` | Queue (TTL, no consumers) | Hold a failed message, then dead-letter it back to `events.main`. |
| `events.dlq` | Queue (durable) | Permanent failures and exhausted retries. |
| `events.dead` | Direct exchange | Routes dead-lettered messages: key `events.dlq` to the DLQ, key `events.main` back to the main queue. |

---

## 🧠 Event Lifecycle

```mermaid
sequenceDiagram
    participant Client
    participant API
    participant RabbitMQ
    participant Worker
    participant Postgres

    Client->>API: POST /events
    API->>API: Validate with Zod
    API->>RabbitMQ: Publish (persistent, confirm)
    RabbitMQ-->>API: Confirm
    API-->>Client: 202 Accepted
    RabbitMQ->>Worker: Deliver message
    Worker->>Worker: Validate again (queue is untrusted)
    Worker->>Postgres: BEGIN, insert event, update status if newer
    alt Commit succeeds
        Postgres-->>Worker: COMMIT
        Worker->>RabbitMQ: ack
    else Transient error, attempts left
        Worker->>RabbitMQ: Publish copy to retry queue, then ack original
    else Permanent error or attempts exhausted
        Worker->>RabbitMQ: nack (routed to DLQ)
    end
```

### Key design decisions

- **Ack after commit.** Gives crash safety at the cost of possible duplicates, which idempotency absorbs.
- **Ordering does not depend on the queue.** Retries reorder messages anyway, so correctness comes from comparing `occurredAt`, not from arrival order. Late events are still stored in history.
- **Retry by republishing, then acking.** If the worker dies between the two steps you get a duplicate, never a loss.
- **One shared topology function.** The API and worker declare queues from the same code, because RabbitMQ rejects redeclaring a queue with different arguments.

---

## 🚀 Getting Started

### Prerequisites

- **Node.js 20 or 22**
- **Docker Desktop** (runs RabbitMQ and PostgreSQL)

### 1. Clone the Repository

```bash
git clone https://github.com/prasadbelsare/event-processing-system.git
cd event-processing-system
```

### 2. Install and Start Infrastructure

```bash
npm install
docker compose up -d
```

### 3. Configure Environment

Create a `.env` file in the project root:

```
RABBITMQ_URL=amqp://guest:guest@127.0.0.1:5672
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5440/events
PORT=3000
API_URL=http://127.0.0.1:3000
PROCESS_DELAY_MS=0
```

> Postgres is mapped to host port **5440** to avoid clashing with a local Postgres install on 5432. If you change `PORT`, change `API_URL` too.

### 4. Create the Schema

```bash
npm run migrate
```

### 5. Run the API and Workers

Use separate terminals:

```bash
npm run api       # HTTP API on port 3000
npm run worker    # run in several terminals for several workers
```

*The RabbitMQ management UI is at `http://localhost:15672` (login `guest` / `guest`).*

### 6. Try It

```bash
npm run send                          # one valid event
npm run send -- DELIVERED PKG-1001    # choose status and package
npm run send-dup                      # same event sent 3 times
npm run send-poison                   # malformed message published straight to the queue
```

---

## 🛠️ Technology Stack

| Component | Technology | Description |
|:---|:---|:---|
| **Language** | **TypeScript / Node.js** | Strict typing end to end. |
| **API** | **Express** | HTTP ingestion endpoint. |
| **Message Broker** | **RabbitMQ** (`amqplib`) | Queues, exchanges, TTL retry queues, dead-lettering. |
| **Database** | **PostgreSQL** (`pg`) | Event history and current package state. |
| **Validation** | **Zod** | One schema for runtime validation and compile-time types. |
| **Infrastructure** | **Docker Compose** | One command starts RabbitMQ and PostgreSQL. |

---

## 🧪 API Endpoints

| Method | Endpoint | Description |
|:---|:---|:---|
| `POST` | `/events` | Validates and queues an event. Returns `202` (queued), `400` (invalid), or `503` (broker did not confirm). |
| `GET` | `/health` | Liveness check. |

### Event format

```json
{
  "eventId": "3f2b8c1e-0c53-4a39-9a1b-6d0f6a4d2e11",
  "packageId": "PKG-1001",
  "eventType": "STATUS_CHANGED",
  "occurredAt": "2026-10-27T16:00:00Z",
  "payload": { "status": "IN_TRANSIT", "location": "Denver Hub" }
}
```

Event types: `PACKAGE_SCANNED`, `STATUS_CHANGED`, `DELIVERY_MOVED`.
Statuses: `PICKED_UP`, `IN_TRANSIT`, `OUT_FOR_DELIVERY`, `DELIVERED`, `FAILED_ATTEMPT`.

---

## 💥 Failure Scenarios and Results

Each scenario is an automated script. Start the API first.

| Scenario | Command | Result |
|:---|:---|:---|
| **Out-of-order arrival**: 20 packages, 4 events each, random (seeded) arrival order | `npm run test:order` | 20/20 packages ended `DELIVERED` with all 4 history rows |
| **Duplicates and concurrency**: 100 unique events plus ~30% duplicates, shuffled, 3 workers | `npm run test:concurrency` | Exactly 100 history rows; every status matched its newest event |
| **Worker crash**: worker `SIGKILL`ed with 10 unacked messages in flight | `npm run test:crash` | Second worker received them as redelivered; 30/30 events saved |
| **Short database outage** (12s, inside the retry window) | `npm run test:db-outage` | Events bounced through retry tiers; 20/20 saved after recovery |
| **Long database outage** (60s, beyond the retry window) | `npm run test:db-outage -- 60` | 0/20 saved; all 20 moved to `events.dlq` with `x-attempt: 4`, none lost |

<!-- *Run `npm run test:order -- <seed> <rounds>` to reproduce a specific randomized run.* -->

<!-- ---

## 📸 Screenshots

*(Add a screenshot of the RabbitMQ UI showing the retry queues and DLQ during `npm run test:db-outage -- 60`.)* -->

---

## 🗂️ Project Structure

```
src/
  api/        Express app: validate, publish, respond
  worker/     Consumer, retry and DLQ logic, transactional processing
  shared/     Config, Zod event schema, RabbitMQ topology and helpers, DB pool
  db/         schema.sql and migration script
scripts/      Event senders and the failure/correctness test scripts
docker-compose.yml   RabbitMQ and PostgreSQL
```

---

## ⚠️ Known Limitations

- The API holds one RabbitMQ connection and does not reconnect after a broker restart; it must be restarted.
- `PACKAGE_SCANNED` and `DELIVERY_MOVED` both map to `IN_TRANSIT`, so a late scan with a newer timestamp can overwrite `DELIVERED`. A better model would update only the location for scans.
- Events with identical `occurredAt` for the same package resolve as first-processed-wins.
- Retry tiers (5s / 15s / 30s) are shortened for testing; production values would be longer.
- Messages in `events.dlq` must currently be inspected and replayed by hand.
- Only the infrastructure runs in Docker; the API and workers run on the host.
