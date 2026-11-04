import type { SiteTaxonomyDTO } from '@scribe/core';
import { Field, inputClass } from './ui';

/**
 * Category (single) + tag (multi) pickers, populated from the site's Strapi
 * taxonomy. Rendered inside the review editor form; on save the selected slugs
 * are stored on the article and resolved to Strapi documentIds at publish.
 */
export function TaxonomyFields({
  taxonomy,
  categorySlug,
  tagSlugs,
}: {
  taxonomy: SiteTaxonomyDTO;
  categorySlug: string | null;
  tagSlugs: string[];
}) {
  const selectedTags = new Set(tagSlugs);
  return (
    <div className="grid gap-3 rounded-md border border-border bg-panel-2 p-3">
      <input type="hidden" name="taxonomyPicker" value="1" />
      <Field label="Category" name="categorySlug" hint="Connected to the CMS category on publish.">
        <select
          id="categorySlug"
          name="categorySlug"
          defaultValue={categorySlug ?? ''}
          className={inputClass}
        >
          <option value="">None</option>
          {taxonomy.categories.map((category) => (
            <option key={category.slug} value={category.slug}>
              {category.name}
            </option>
          ))}
        </select>
      </Field>
      <div className="grid gap-1.5 text-sm">
        <span className="text-xs font-medium text-muted">Tags</span>
        {taxonomy.tags.length === 0 ? (
          <span className="text-xs text-muted/70">No tags found in the CMS.</span>
        ) : (
          <div className="flex flex-wrap gap-2">
            {taxonomy.tags.map((tag) => (
              <label
                key={tag.slug}
                className="flex items-center gap-1.5 rounded border border-border bg-panel px-2 py-1 text-xs"
              >
                <input
                  type="checkbox"
                  name="tagSlugs"
                  value={tag.slug}
                  defaultChecked={selectedTags.has(tag.slug)}
                />
                {tag.name}
              </label>
            ))}
          </div>
        )}
        <span className="text-xs text-muted/70">Connected to CMS tags on publish.</span>
      </div>
    </div>
  );
}
