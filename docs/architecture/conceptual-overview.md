# Operon conceptual overview

Operon is an installable **org runtime**: a standing AI company that develops
and operates a portfolio of independent software products. One human leads the
company by setting goals and guardrails and by making the critical decisions.
Operon handles the day-to-day work needed to turn that direction into software
outcomes.

```mermaid
flowchart TB
    subgraph LEADERSHIP[" "]
        direction LR
        HUMAN["Human<br/><b>Direction · final authority</b>"]
        COMPANY["Operon<br/><b>The standing AI company</b>"]

        HUMAN ==>|goals and guardrails| COMPANY
        COMPANY -->|outcomes and consequential decisions| HUMAN
    end

    subgraph WORK["What the company does"]
        direction TB
        OPERATIONS["Day-to-day operations<br/><b>Plans · builds · reviews · runs</b>"]

        subgraph PORTFOLIO["Product portfolio"]
            direction LR
            PRODUCT_1["Product 1"]
            PRODUCT_2["Product 2"]
        end

        subgraph TEAMS["Specialist agents working within each product"]
            direction LR
            TEAM_1["Product 1 agents"]
            TEAM_2["Product 2 agents"]
        end

        LEARNING["Company learning and memory<br/><b>Experience improves future work</b>"]

        OPERATIONS --> PRODUCT_1
        OPERATIONS --> PRODUCT_2
        PRODUCT_1 --> TEAM_1
        PRODUCT_2 --> TEAM_2
        TEAM_1 --> LEARNING
        TEAM_2 --> LEARNING
        LEARNING -.->|learned over time| OPERATIONS
    end

    COMPANY --> OPERATIONS
```

Read the diagram as an organization, not as an implementation architecture.
The human runs the company rather than its task queue. Operon coordinates the
routine planning, building, independent review, and operation of each product,
while returning consequential decisions and visible outcomes to the human.

Each product remains independent and has agents working in its own context.
Their experience feeds a shared company learning and memory system, so lessons
from real work can improve how the company operates over time without erasing
the boundaries between products.
