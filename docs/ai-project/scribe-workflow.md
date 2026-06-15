# Scribe Workflow For AI Assistants

This document tells an external AI assistant how to work with Scribe.

## Scribe Is The Source Of Truth

Scribe stores:

- sites
- style guides
- keyword seeds
- article drafts
- image prompts
- uploaded images
- review decisions
- publish records
- CMS credentials, encrypted and never visible to the assistant

Do not ask the user to paste secrets. Do not ask for Strapi tokens or API keys.

## Normal Article Workflow

1. Use the site context to create or improve a style guide.
2. Suggest keyword ideas and validate them.
3. Pick one keyword and draft an article.
4. Return Scribe-ready fields:
   - title
   - slug
   - metaDescription
   - contentMarkdown
   - imagePrompt
5. The user reviews the article inside Scribe.
6. The user generates the image manually from the prompt.
7. The user uploads the image in Scribe.
8. The user approves the article.
9. An Admin publishes the article from Scribe to Strapi.

## Scribe-Ready Article Prompt

```text
Using the attached site context and style guide, create a Scribe-ready article.

Keyword:
[keyword]

Extra instructions:
[instructions]

Return only JSON:
{
  "title": "",
  "slug": "",
  "metaDescription": "",
  "contentMarkdown": "",
  "imagePrompt": ""
}

The article must:
- match search intent
- fit the site's business
- avoid generic filler
- include practical examples
- include a detailed manual hero-image prompt
- include supporting image prompts only if they improve the article
```

## Validation Before Sending To Scribe

Before returning a final draft, run this self-check:

- Is the keyword intent clear?
- Does the title match the content?
- Is the article useful without being bloated?
- Are claims safe and supportable?
- Does the article fit the site?
- Is the image prompt detailed and brand-safe?
- Is the JSON valid?

## Publishing Notes

Scribe publishes approved articles to Strapi using the site's configured field
map. Publishing can create a draft or published entry depending on the site's
Strapi configuration.

The current publish flow sends article text and metadata. If a site needs image
publishing into a Strapi media field, the exact Strapi media field name and
relation shape must be configured separately.

