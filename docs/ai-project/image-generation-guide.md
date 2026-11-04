# Image Generation Guide

Scribe now uses manual image generation. The LLM should create detailed image
prompts, then a human generates the image externally and uploads the result into
the article.

## Standard Hero Image Prompt Formula

Use this structure:

```text
Hero image for an article titled "[title]".

Subject:
[main object/person/scene]

Setting:
[where the scene happens]

Composition:
[camera angle, framing, foreground/background, negative space]

Style:
[realistic photo / editorial illustration / clean 3D / flat vector / etc.]

Lighting and mood:
[bright, calm, premium, practical, trustworthy, etc.]

Brand fit:
[site-specific visual direction]

Aspect ratio:
[16:9 for article hero unless another format is required]

Avoid:
[logos, text in image, fake UI, distorted hands, misleading money claims, clutter, copyrighted characters]
```

## Scribe Image Prompt Output

When returning `imagePrompt`, use:

```text
Hero image:
[full detailed prompt]

Supporting image 1:
[only if the article genuinely benefits from another image]

Supporting image 2:
[only if needed]
```

## Good Prompt Example

```text
Hero image for an article titled "How to Build Wealth With a Simple Monthly Plan".

Subject: a clean desk scene with a notebook showing a simple monthly budget grid,
a laptop with a neutral dashboard-like screen, a calculator, and a small plant.

Setting: modern home office, natural morning light, calm and organized.

Composition: 16:9 editorial hero image, slightly overhead angle, notebook and
laptop centered, enough clean negative space on the left for a website title
overlay, soft background blur.

Style: realistic editorial photography, premium personal finance blog aesthetic,
natural colors, crisp but not overly glossy.

Lighting and mood: bright, trustworthy, practical, calm, optimistic.

Brand fit: educational, grounded, non-hype, accessible to beginners.

Avoid: visible brand logos, readable private data, text overlays, piles of cash,
luxury flexing, crypto charts, distorted hands, fake app interfaces.
```

## Image Types By Article Formula

How-to:
- Process scene.
- Tools laid out clearly.
- Before/after concept.

Comparison:
- Two-option visual balance.
- Split workspace.
- Neutral decision-making scene.

Best/listicle:
- Curated set of objects.
- Clean product/tool arrangement.
- Abstract ranking concept without numbers in image.

Mistakes:
- Subtle problem scene.
- Avoid panic or shame.
- Use repair, correction, checklist, or warning symbol carefully.

Checklist:
- Organized checklist, notebook, dashboard, planning surface.

Finance:
- Use calm planning visuals.
- Avoid unrealistic wealth imagery, luxury cars, cash stacks, fake guarantees,
  and anything that implies guaranteed returns.

## Data Visualizations (charts, graphs, stat graphics)

When an in-body image is a chart, graph, stat graphic, or comparison, the prompt
must make the image accurate to the article's data:

- Include the **exact figures from the article** — every value, label, category,
  unit, and axis range — taken verbatim from the text. The chart must match what
  the article says.
- State the chart type explicitly (bar, line, pie, comparison table image, etc.)
  and list each data point/label precisely (e.g. "bars: 2022 = $1,000, 2023 =
  $1,250, 2024 = $1,600; y-axis $0–$2,000 in $500 steps; label axes 'Year' and
  'Emergency fund'").
- **Never invent, round, or estimate numbers that are not in the article.** If a
  section has no concrete data, use a conceptual illustration instead of a fake
  chart — do not fabricate data to fill a graph.
- Data charts are the one case where text/numbers belong inside the image; for
  all other images keep the general "no text in image" rule.

## Validation Checklist

Before using an image prompt, check:

- Does it match the article's exact angle?
- Does it fit the site's brand?
- Is it specific enough for a good image?
- Does it avoid text embedded in the image?
- Does it avoid misleading claims?
- Is the aspect ratio clear?
- Would it still make sense if the article title changes slightly?

