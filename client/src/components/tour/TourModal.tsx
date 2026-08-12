import { useEffect, useState } from "react";
import { Link } from "wouter";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { TOUR_STEPS, TourStep, TourRole } from "./tourSteps";
import {
  Sparkles,
  Users,
  Send,
  Repeat,
  BarChart3,
  HeartPulse,
  Settings,
  FlaskConical,
  GitBranch,
  Megaphone,
  Trophy,
  Star,
  Bot,
  X,
} from "lucide-react";

// Icon registry — maps iconName strings from tourSteps to Lucide components
const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  Sparkles,
  Users,
  Send,
  Repeat,
  BarChart3,
  HeartPulse,
  Settings,
  FlaskConical,
  GitBranch,
  Megaphone,
  Trophy,
  Star,
  Bot,
};

interface TourModalProps {
  open: boolean;
  role: TourRole;
  onClose: (completed: boolean) => void;
}

function StepIllustration({ step }: { step: TourStep }) {
  const Icon = ICON_MAP[step.iconName] ?? Sparkles;
  return (
    <div
      className={cn(
        "flex items-center justify-center w-full h-48 sm:h-full sm:min-h-[340px] rounded-t-lg sm:rounded-l-lg sm:rounded-tr-none",
        step.accentBg
      )}
    >
      <Icon className={cn("w-20 h-20 sm:w-24 sm:h-24", step.accentText)} />
    </div>
  );
}

function ProgressDots({ total, current }: { total: number; current: number }) {
  return (
    <div className="flex items-center gap-1.5" aria-label={`Step ${current + 1} of ${total}`}>
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          className={cn(
            "rounded-full transition-all duration-300",
            i === current
              ? "w-4 h-2 bg-primary"
              : "w-2 h-2 bg-muted-foreground/30"
          )}
        />
      ))}
    </div>
  );
}

export function TourModal({ open, role, onClose }: TourModalProps) {
  const steps = TOUR_STEPS[role] ?? TOUR_STEPS.agent;
  const [currentIndex, setCurrentIndex] = useState(0);
  const [visible, setVisible] = useState(true);

  // Reset to step 1 every time the modal opens
  useEffect(() => {
    if (open) {
      setCurrentIndex(0);
      setVisible(true);
    }
  }, [open]);

  const step = steps[currentIndex];
  const isLast = currentIndex === steps.length - 1;

  function animateToNext(nextIdx: number) {
    setVisible(false);
    setTimeout(() => {
      setCurrentIndex(nextIdx);
      setVisible(true);
    }, 150);
  }

  function handleNext() {
    if (isLast) {
      onClose(true);
    } else {
      animateToNext(currentIndex + 1);
    }
  }

  function handleSkip() {
    onClose(false);
  }

  if (!open) return null;

  return (
    <DialogPrimitive.Root open={open} modal>
      <DialogPrimitive.Portal>
        {/* Overlay */}
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0" />

        {/* Content */}
        <DialogPrimitive.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2",
            "w-[calc(100vw-2rem)] max-w-3xl",
            "bg-background rounded-xl shadow-2xl border overflow-hidden",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
            "focus:outline-none"
          )}
          // Prevent closing on outside click or escape
          onPointerDownOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
          aria-labelledby="tour-title"
          aria-describedby="tour-body"
        >
          <div className="flex flex-col sm:flex-row">
            {/* Left / Top illustration panel */}
            <div className="sm:w-[40%] shrink-0">
              <StepIllustration step={step} />
            </div>

            {/* Right / Bottom content panel */}
            <div className="flex flex-col flex-1 p-6 sm:p-8 gap-4">
              {/* Step badge */}
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
                  Step {currentIndex + 1} of {steps.length}
                </span>
                <button
                  onClick={handleSkip}
                  aria-label="Skip tour"
                  className="rounded-sm p-1 opacity-60 hover:opacity-100 transition-opacity"
                  data-testid="button-tour-skip"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Animated content */}
              <div
                className="flex-1 transition-opacity duration-150"
                style={{ opacity: visible ? 1 : 0 }}
              >
                <DialogPrimitive.Title
                  id="tour-title"
                  className="text-2xl font-bold tracking-tight mb-3"
                >
                  {step.title}
                </DialogPrimitive.Title>
                <DialogPrimitive.Description
                  id="tour-body"
                  className="text-muted-foreground leading-relaxed text-sm sm:text-base"
                >
                  {step.body}
                </DialogPrimitive.Description>
              </div>

              {/* Progress + actions */}
              <div className="flex flex-col gap-4 mt-2">
                <ProgressDots total={steps.length} current={currentIndex} />

                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                  {/* Optional CTA on final step */}
                  {isLast && step.cta && (
                    <Link href={step.cta.href} onClick={() => onClose(true)}>
                      <Button
                        variant="outline"
                        className="w-full sm:w-auto"
                        data-testid="button-tour-cta"
                      >
                        {step.cta.label}
                      </Button>
                    </Link>
                  )}

                  <Button
                    className="w-full sm:w-auto sm:ml-auto"
                    onClick={handleNext}
                    data-testid={isLast ? "button-tour-finish" : "button-tour-next"}
                  >
                    {isLast ? "Start using Liberty Bancard" : "Next →"}
                  </Button>
                </div>

                {!isLast && (
                  <button
                    onClick={handleSkip}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors text-left"
                    data-testid="button-tour-skip-text"
                  >
                    Skip tour
                  </button>
                )}
              </div>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
