import type { ArticleImageDTO } from '@scribe/core';
import { Card, Field, Badge, inputClass } from './ui';
import { ActionForm } from './action-form';
import {
  generateArticleInlineImageAction,
  uploadArticleInlineImageAction,
  suggestInlineImagesAction,
} from '@/server/actions';

/**
 * Lists the in-body (supporting) images the drafter suggested for an article —
 * each with its placement, alt text, aspect ratio, and prompt — and lets an
 * editor generate or upload each one. The reviewer places the finished image
 * under the noted heading when publishing.
 */
export function InlineImagesCard({
  articleId,
  images,
  canEdit,
}: {
  articleId: string;
  images: ArticleImageDTO[];
  canEdit: boolean;
}) {
  return (
    <Card
      title="In-body images"
      description="Supporting visuals the draft suggested for specific sections. Generate or upload each, then place it under the noted heading when you publish."
    >
      {images.length === 0 ? (
        <div className="grid gap-2">
          <p className="text-sm text-muted">
            No in-body images yet. Longer articles often benefit from a chart, flowchart, or
            comparison visual.
          </p>
          {canEdit ? (
            <ActionForm action={suggestInlineImagesAction} submitLabel="Suggest in-body images (AI)">
              <input type="hidden" name="id" value={articleId} />
            </ActionForm>
          ) : null}
        </div>
      ) : (
        <div className="grid gap-3">
          {images.map((image, index) => {
            const src =
              image.mimeType && image.dataBase64
                ? `data:${image.mimeType};base64,${image.dataBase64}`
                : null;
            const fileInputId = `inline-image-file-${image.id}`;
            return (
              <div key={image.id} className="rounded-md border border-border bg-panel-2 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold">Image {index + 1}</span>
                  <div className="flex gap-1.5">
                    {image.aspectRatio ? <Badge tone="muted">{image.aspectRatio}</Badge> : null}
                    <Badge tone={src ? 'ok' : 'warn'}>{src ? 'Added' : 'Needed'}</Badge>
                  </div>
                </div>

                {image.placement ? (
                  <p className="mt-1 text-xs text-muted">
                    Place under: <span className="text-fg">{image.placement}</span>
                  </p>
                ) : null}

                {src ? (
                  <img
                    src={src}
                    alt={image.alt ?? `In-body image ${index + 1}`}
                    className="mt-2 aspect-video w-full rounded-md object-cover"
                  />
                ) : null}

                {image.alt ? (
                  <p className="mt-2 text-xs text-muted">
                    Alt text: <span className="text-fg">{image.alt}</span>
                  </p>
                ) : null}

                <div className="mt-2 rounded-md border border-border bg-panel p-2.5">
                  <div className="text-xs font-medium text-muted">Prompt</div>
                  <p className="mt-1 whitespace-pre-wrap text-sm leading-5">{image.prompt}</p>
                </div>

                {canEdit ? (
                  <div className="mt-2 grid gap-2">
                    <ActionForm
                      action={generateArticleInlineImageAction}
                      submitLabel="Generate with AI"
                    >
                      <input type="hidden" name="articleId" value={articleId} />
                      <input type="hidden" name="imageId" value={image.id} />
                    </ActionForm>
                    <ActionForm
                      action={uploadArticleInlineImageAction}
                      submitLabel={src ? 'Replace image' : 'Upload image'}
                      encType="multipart/form-data"
                    >
                      <input type="hidden" name="articleId" value={articleId} />
                      <input type="hidden" name="imageId" value={image.id} />
                      <Field
                        label="Image file"
                        name={fileInputId}
                        hint="JPEG, PNG, WebP, AVIF, or GIF. Max 5 MB."
                      >
                        <input
                          id={fileInputId}
                          name="imageFile"
                          type="file"
                          accept="image/jpeg,image/png,image/webp,image/avif,image/gif"
                          required
                          className={inputClass}
                        />
                      </Field>
                    </ActionForm>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
