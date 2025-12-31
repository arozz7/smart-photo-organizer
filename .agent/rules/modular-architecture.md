---
trigger: always_on
---

# Modular Architecture Standards
(Activation: Always On)

## Core Principle: Separation of Concerns
All systems must be composed of three distinct, loosely coupled layers.
**Goal:** We must be able to swap the LLM, the Database, or the API Tools without rewriting the business logic.

### 1. The Reasoning Layer (The "Brain")
* **Responsibility:** Pure business logic, decision trees, and prompt orchestration.
* **Constraint:** NEVER hardcode tool implementations inside logic.
* **Interface:** Must interact with the outside world *only* via the `Tools Layer` interfaces.
* **State:** Stateless. It receives `Memory` context, decides, and calls a `Tool`.

### 2. The Memory Layer (The "Context")
* **Responsibility:** Managing state, history, and long-term storage (RAG/Vector DB).
* **Constraint:** The application logic should not know *how* memory is stored (e.g., Redis vs. JSON file).
* **Pattern:** Use the **Repository Pattern**.
    * ✅ `memory.save_context(data)`
    * ❌ `redis.set(data)`

### 3. The Tools Layer (The "Hands")
* **Responsibility:** Executing side effects (API calls, File I/O, Third-party SDKs).
* **Constraint:** All tools must be wrapped in standard **Interfaces/Abstract Base Classes**.
* **Pattern:** **Adapter Pattern**.
    * Create a generic interface `IMailer` or `IFileStore`.
    * Implement `SendGridMailer` or `S3FileStore` separately.
    * *Why?* This allows us to switch from SendGrid to SES by changing one config line, not the agent's logic.

## 🛑 Coding Guardrails
1.  **No Direct Vendor Imports:** Do not import `openai` or `langchain` directly in business logic files. Wrap them in a `service` (e.g., `LLMService`).
2.  **Dependency Injection:** Always pass tools/memory into the reasoning engine as arguments (or via constructor), never instantiate them inside.
3.  **Config Driven:** Prompts and Model configurations must live in external configuration files (JSON/YAML), not in code.