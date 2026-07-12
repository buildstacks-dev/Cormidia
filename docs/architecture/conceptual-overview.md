# Operon conceptual overview

Operon is an installable **org runtime**, not an application. One human directs
a standing AI company that develops and operates a portfolio of independent
software products. The team handles routine work autonomously; the human keeps
final authority over policy and critical operations.

```mermaid
flowchart TB
    HUMAN["Human operator<br/><b>Sets goals and policy</b><br/>Approves critical operations<br/>Reviews outcomes and reports"]

    subgraph OPERON["Operon — the standing AI company"]
        direction TB

        subgraph TEAM["Specialist roles"]
            direction LR
            PLAN["Planner<br/>priorities and tickets"]
            BUILD["Builder<br/>features and fixes"]
            REVIEW["Independent Reviewer<br/>quality and acceptance"]
            SRE["SRE<br/>reliability and releases"]
            SUPPORT["Support<br/>user needs and feedback"]
            MARKETING["Marketing<br/>adoption and communication"]
            LEARN["Learning team<br/>evidence and improvement"]
        end

        COORD["Org runtime<br/>Schedules work · assembles context · runs protocols<br/>Preserves progress · tracks budgets · enforces authority"]
        GATE{"Critical-operation gate"}

        PLAN --> BUILD --> REVIEW
        SUPPORT --> PLAN
        MARKETING --> PLAN
        SRE --> PLAN
        COORD <--> PLAN
        COORD <--> SRE
        COORD <--> SUPPORT
        COORD <--> MARKETING
        LEARN -.->|improves future work| COORD
        COORD --> GATE
    end

    subgraph WORK["Shared work system"]
        GH[("Private GitHub repos<br/>Issues · code · pull requests<br/>reviews · decisions")]
        EVIDENCE[("Durable operating record<br/>Runs · approvals · cost<br/>memory · scorecards")]
    end

    subgraph PORTFOLIO["Software portfolio — one org, many apps"]
        direction LR
        APP_A["App A<br/>Own code, policy,<br/>context and memory"]
        APP_B["App B<br/>Own code, policy,<br/>context and memory"]
        APP_N["App N<br/>Own code, policy,<br/>context and memory"]
    end

    WORLD["Customers and the outside world<br/>Feedback · adoption · incidents · service health"]
    OUTCOME["Verified software outcomes<br/>Planned · built · independently reviewed · operated"]

    HUMAN ==>|goals, policy and priorities| COORD
    GATE ==>|critical decision only| HUMAN
    EVIDENCE -.->|live view and reports| HUMAN

    GATE -->|routine work proceeds| GH
    GH <--> APP_A
    GH <--> APP_B
    GH <--> APP_N
    COORD --> EVIDENCE
    GH --> EVIDENCE

    WORLD --> APP_A
    WORLD --> APP_B
    WORLD --> APP_N
    WORLD -->|user signals| SUPPORT
    WORLD -->|operational signals| SRE
    WORLD -->|adoption signals| MARKETING
    APP_A --> OUTCOME
    APP_B --> OUTCOME
    APP_N --> OUTCOME

    NOTE["Each turn works on exactly one app.<br/>Adding an app is configuration, not a fork of Operon."]
    APP_B --- NOTE
```

## How to read it

1. The human supplies goals, organizational policy, and genuine high-impact
   decisions—not day-to-day scheduling or retry supervision.
2. Operon turns those goals and incoming product signals into coordinated work
   across specialist AI roles. The Builder and Reviewer remain independent.
3. GitHub holds the inspectable work artifacts for each product, while Operon
   keeps the durable operating record needed for continuity, governance, cost
   control, and learning.
4. Every application remains a separate product repository with its own
   context and policy. Operon can manage many apps, but a single role turn is
   always scoped to one app.
5. Routine, reversible work proceeds autonomously. Production deploys and
   other critical operations return to the human through the approval gate.
