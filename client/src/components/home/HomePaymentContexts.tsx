import { PublicImage } from "@/components/public/PublicImage";
import { HOME_PAYMENT_CONTEXTS } from "@shared/public-home-content";
import { HOME_VISUAL_BROWSER_SVG, HOME_VISUAL_PHONE_SVG } from "@shared/public-home-visuals";

/**
 * Payment-setup explanation inside the Home solutions section: Countertop, Mobile and Online as three
 * cards that stack on phones (visual beside the text) and sit side by side from md. It is live text, so it
 * stays readable at 390 px, with one illustrative terminal image inside Countertop. It makes no
 * compatibility, availability or equipment claim; the caption says setups are confirmed during review.
 * The server-rendered Home emits the same contexts from the same record.
 */
const STATIC_VISUALS = { phone: HOME_VISUAL_PHONE_SVG, browser: HOME_VISUAL_BROWSER_SVG } as const;

export function HomePaymentContexts() {
  const { terminalImage } = HOME_PAYMENT_CONTEXTS;
  return (
    <div className="mt-10 md:mt-12" role="group" aria-labelledby="home-payment-contexts-heading" aria-describedby="home-payment-contexts-description" data-testid="block-payment-contexts">
      <p className="public-eyebrow public-eyebrow--brand mb-2">{HOME_PAYMENT_CONTEXTS.eyebrow}</p>
      <h3 id="home-payment-contexts-heading" className="public-h3 text-foreground" data-testid="text-payment-contexts-heading">{HOME_PAYMENT_CONTEXTS.heading}</h3>
      <p className="public-body public-secondary mt-1">{HOME_PAYMENT_CONTEXTS.intro}</p>
      <span id="home-payment-contexts-description" className="sr-only">{HOME_PAYMENT_CONTEXTS.description}</span>
      <ul className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3 md:gap-5">
        {HOME_PAYMENT_CONTEXTS.contexts.map((context) => (
          <li key={context.id} className="public-card flex items-center gap-4 p-4 md:flex-col md:items-start md:gap-3 md:p-5" data-testid={`card-payment-context-${context.id}`}>
            <div className="flex h-36 w-24 shrink-0 items-center justify-center rounded-lg bg-muted/60 md:w-full">
              {context.visual === "terminal" ? (
                <div className="w-20">
                  <PublicImage id={terminalImage.id} variant={terminalImage.variant} sizes={terminalImage.sizes} data-testid="img-payment-terminal" />
                </div>
              ) : (
                <span className="block h-36 w-24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: STATIC_VISUALS[context.visual] }} />
              )}
            </div>
            <div className="min-w-0">
              <h4 className="public-card-title text-foreground">{context.title}</h4>
              <p className="public-small public-secondary mt-1">{context.body}</p>
            </div>
          </li>
        ))}
      </ul>
      <p className="public-caption public-secondary mt-3" data-testid="text-payment-contexts-caption">{HOME_PAYMENT_CONTEXTS.caption}</p>
    </div>
  );
}
