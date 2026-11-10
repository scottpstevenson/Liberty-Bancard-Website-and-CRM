import { describePicture, type PictureArgs } from "../../client/src/lib/public-imagery";

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export interface PictureHtmlOptions {
  pictureClass?: string;
  imgClass?: string;
}

/**
 * Server markup for one responsive picture. It renders the same describePicture() model as the React
 * PublicImage component, in the same attribute order, so the first document and the hydrated page carry
 * the same image id, sources, srcset, sizes, intrinsic dimensions, alt text and loading/priority
 * attributes. Only the class names differ (the document has its own inline stylesheet).
 */
export function pictureHtml(args: PictureArgs, options: PictureHtmlOptions = {}): string {
  const model = describePicture(args);
  const { img } = model;
  const sources = model.sources
    .map(
      (source) =>
        `<source${source.media ? ` media="${esc(source.media)}"` : ""} type="${esc(source.type)}" srcset="${esc(source.srcSet)}" sizes="${esc(source.sizes)}">`,
    )
    .join("");
  const imgTag =
    `<img src="${esc(img.src)}" srcset="${esc(img.srcSet)}" sizes="${esc(img.sizes)}" width="${img.width}" height="${img.height}"` +
    ` alt="${esc(img.alt)}" loading="${img.loading}" decoding="${img.decoding}"${img.fetchPriority ? ` fetchpriority="${img.fetchPriority}"` : ""}` +
    `${options.imgClass ? ` class="${esc(options.imgClass)}"` : ""}>`;
  return `<picture${options.pictureClass ? ` class="${esc(options.pictureClass)}"` : ""}>${sources}${imgTag}</picture>`;
}
