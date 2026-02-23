# Memory Bank Skill

Structured long-term memory with typed categories, lifecycle management (decay, reinforcement, reflection), and semantic recall.

## Memory Types

| Type | Purpose | Example |
|------|---------|---------|
| `episodic` | Events and experiences | "User deployed app to Vercel on Feb 20" |
| `semantic` | Facts and knowledge | "User's company is AXI Mobility" |
| `procedural` | How-to instructions | "To deploy: run npm build then vercel --prod" |
| `preference` | User preferences | "User prefers Tailwind CSS over plain CSS" |

## Tools

### memory_store_typed
Store a typed memory with importance score.

```yaml
name: memory_store_typed
description: Store a structured memory with type and importance. Types: episodic (events), semantic (facts), procedural (how-to), preference (user likes).
parameters:
  type: object
  properties:
    text:
      type: string
      description: The memory content to store
    memory_type:
      type: string
      description: "Memory type: episodic, semantic, procedural, preference"
    source:
      type: string
      description: Source context (e.g. conversation, tool, observation)
    importance:
      type: number
      description: "Importance score 1-10 (default: 5). Higher = more resistant to decay"
    tags:
      type: string
      description: "Comma-separated tags for categorization"
  required: [text, memory_type]
```

### memory_reflect
AI-powered memory consolidation. Merges similar memories and extracts patterns.

```yaml
name: memory_reflect
description: Consolidate memories by merging duplicates (cosine > 0.9) and extracting patterns. Run periodically to keep memory clean.
parameters:
  type: object
  properties: {}
```

### memory_forget
Fuzzy delete memories matching a query.

```yaml
name: memory_forget
description: Remove memories that match a query. Uses semantic similarity to find and delete matching entries.
parameters:
  type: object
  properties:
    query:
      type: string
      description: What to forget (semantic match)
  required: [query]
```

### memory_list_categories
Show counts per memory type.

```yaml
name: memory_list_categories
description: List memory counts broken down by type (episodic, semantic, procedural, preference).
parameters:
  type: object
  properties: {}
```

### memory_get_context
Get relevant memories formatted for system prompt injection.

```yaml
name: memory_get_context
description: Retrieve relevant memories for a query, formatted as context for conversation. Used internally to enrich agent responses.
parameters:
  type: object
  properties:
    query:
      type: string
      description: Context query to find relevant memories
    limit:
      type: number
      description: "Max memories to return (default: 5)"
  required: [query]
```

## Lifecycle

- **Storage**: Memories are embedded and stored with type, importance, and tags
- **Recall**: Semantic search retrieves relevant memories; accessed memories get reinforced
- **Reinforcement**: Each access boosts importance by 0.5 (capped at 10)
- **Decay**: Time-based: `effective = importance * max(0.1, 1 - days_since_access * 0.01)`. Deleted if < 1
- **Reflection**: Periodic consolidation merges near-duplicates (cosine > 0.9)
