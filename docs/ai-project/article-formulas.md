# Article Formulas

Use these formulas to turn a keyword into a useful article structure.

## 1. Direct How-To

Best for: "how to", beginner, setup, process, problem-solving queries.

Structure:

1. Short answer or promise.
2. Who this is for.
3. Prerequisites or assumptions.
4. Step-by-step process.
5. Example.
6. Common mistakes.
7. Checklist.
8. Next step.

Prompt:

```text
Create a Scribe-ready how-to article for:
Keyword: [keyword]
Audience: [audience]
Goal: [reader goal]

Use this structure:
- direct answer introduction
- step-by-step H2 sections
- practical example
- common mistakes
- final checklist
- conclusion with next step

Return title, slug, metaDescription, contentMarkdown, and imagePrompt.
```

## 2. Complete Beginner Guide

Best for: broad educational keywords where the reader needs orientation.

Structure:

1. What it is.
2. Why it matters.
3. Key terms.
4. How it works.
5. First steps.
6. Mistakes to avoid.
7. Tools/resources.
8. FAQ.

Use this only when the topic deserves breadth. Avoid calling everything a
"complete guide" in the title.

## 3. Comparison Article

Best for: "X vs Y", "best option", alternative evaluation.

Structure:

1. Quick verdict.
2. Comparison table.
3. Who should choose X.
4. Who should choose Y.
5. Criteria-by-criteria breakdown.
6. Edge cases.
7. Final recommendation.

Decision criteria examples:

- cost
- ease of use
- risk
- time required
- scalability
- maintenance
- beginner friendliness

## 4. Best/Top List

Best for: commercial or selection queries.

Structure:

1. Selection criteria.
2. Quick comparison table.
3. Ranked list.
4. Best for each use case.
5. How to choose.
6. Mistakes to avoid.

Rules:

- Explain ranking criteria.
- Do not claim personal testing unless true.
- Avoid fake precision.
- Include "best for" labels.

## 5. Mistakes Article

Best for: risk reduction and practical education.

Structure:

1. Why mistakes happen.
2. Mistake list with consequences.
3. Fix for each mistake.
4. Prevention checklist.
5. When to get help.

Use when the reader likely knows the basics but needs better judgment.

## 6. Checklist Article

Best for: repeatable workflows, buying decisions, audits.

Structure:

1. When to use the checklist.
2. The checklist.
3. How to apply it.
4. Example walkthrough.
5. Download/copy version if relevant.

## 7. Definition Plus Action

Best for: "what is" queries that should not become thin glossary content.

Structure:

1. Plain-English definition.
2. Why it matters.
3. Example.
4. How to apply it.
5. Related terms.
6. Next step.

Rule: do not stop at the definition. Add practical application.

## 8. Cost/Value Breakdown

Best for: pricing, budgeting, ROI, finance, tools, services.

Structure:

1. Short answer range or caveat.
2. Cost components.
3. Example scenarios.
4. Hidden costs.
5. How to reduce cost.
6. When paying more is worth it.
7. FAQ.

Do not invent prices. Ask for sources or use placeholders if current data is
required.

## 9. Case Study / Example Article

Best for: credibility and applied learning.

Structure:

1. Situation.
2. Goal.
3. Constraints.
4. Process.
5. Result.
6. Lessons.
7. How readers can apply it.

Never fabricate a real case study. Use hypothetical examples unless real data is
provided.

## 10. Pillar And Cluster Plan

Best for building topical authority.

Pillar article:

- broad topic overview
- links to supporting articles
- explains framework and definitions

Cluster articles:

- one narrow question each
- answer deeply
- link back to pillar
- link to adjacent cluster articles

Prompt:

```text
Create a topical authority cluster for:
Pillar topic: [topic]
Site context: attached

Return:
- pillar article title and keyword
- 12 supporting cluster articles
- search intent for each
- internal linking map
- recommended publish order
```

