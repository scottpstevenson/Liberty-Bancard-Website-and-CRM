import { useState, useEffect } from "react";
import { Clock } from "lucide-react";

interface CountdownTimerProps {
  targetDate: Date;
  label?: string;
  className?: string;
  compact?: boolean;
}

function getTimeRemaining(target: Date) {
  const now = new Date().getTime();
  const diff = Math.max(0, target.getTime() - now);
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((diff % (1000 * 60)) / 1000);
  return { days, hours, minutes, seconds, expired: diff === 0 };
}

function getDefaultTarget() {
  const now = new Date();
  const endOfWeek = new Date(now);
  const dayOfWeek = now.getDay();
  const daysUntilFriday = dayOfWeek <= 5 ? 5 - dayOfWeek : 6;
  endOfWeek.setDate(now.getDate() + Math.max(daysUntilFriday, 1));
  endOfWeek.setHours(23, 59, 59, 999);
  return endOfWeek;
}

export function CountdownTimer({ targetDate, label, className = "", compact = false }: CountdownTimerProps) {
  const [time, setTime] = useState(() => getTimeRemaining(targetDate));

  useEffect(() => {
    const interval = setInterval(() => {
      setTime(getTimeRemaining(targetDate));
    }, 1000);
    return () => clearInterval(interval);
  }, [targetDate]);

  if (time.expired) return null;

  if (compact) {
    return (
      <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${className}`} data-testid="countdown-compact">
        <Clock className="w-3.5 h-3.5" />
        {time.days > 0 && <span>{time.days}d</span>}
        <span>{String(time.hours).padStart(2, "0")}h</span>
        <span>{String(time.minutes).padStart(2, "0")}m</span>
        <span>{String(time.seconds).padStart(2, "0")}s</span>
      </span>
    );
  }

  return (
    <div className={`flex flex-col items-center gap-2 ${className}`} data-testid="countdown-timer">
      {label && <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>}
      <div className="flex items-center gap-2">
        <Clock className="w-4 h-4 text-primary shrink-0" />
        <div className="flex items-center gap-1.5">
          {time.days > 0 && (
            <div className="flex flex-col items-center">
              <span className="text-lg font-bold text-foreground tabular-nums" data-testid="countdown-days">{time.days}</span>
              <span className="text-[10px] text-muted-foreground uppercase">Days</span>
            </div>
          )}
          {time.days > 0 && <span className="text-muted-foreground font-light">:</span>}
          <div className="flex flex-col items-center">
            <span className="text-lg font-bold text-foreground tabular-nums" data-testid="countdown-hours">{String(time.hours).padStart(2, "0")}</span>
            <span className="text-[10px] text-muted-foreground uppercase">Hrs</span>
          </div>
          <span className="text-muted-foreground font-light">:</span>
          <div className="flex flex-col items-center">
            <span className="text-lg font-bold text-foreground tabular-nums" data-testid="countdown-minutes">{String(time.minutes).padStart(2, "0")}</span>
            <span className="text-[10px] text-muted-foreground uppercase">Min</span>
          </div>
          <span className="text-muted-foreground font-light">:</span>
          <div className="flex flex-col items-center">
            <span className="text-lg font-bold text-foreground tabular-nums" data-testid="countdown-seconds">{String(time.seconds).padStart(2, "0")}</span>
            <span className="text-[10px] text-muted-foreground uppercase">Sec</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export { getDefaultTarget };
