"use client"

import * as React from "react"
import { format } from "date-fns"
import { CalendarIcon, X, AlertCircle } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

interface DateTimePickerProps {
  /** ISO string value e.g. "2026-05-11T14:30" */
  value: string
  onChange: (value: string) => void
  /** Minimum selectable date — defaults to now */
  min?: Date
  placeholder?: string
  className?: string
  /**
   * When true (default), shows an inline red warning below the picker
   * whenever the selected datetime is in the past. Set to false to opt
   * out (e.g. when the parent renders its own validation message).
   */
  showPastWarning?: boolean
}

/** Check if an ISO/datetime-local string represents a past moment. Returns
 * false for empty/invalid input so callers can use this for "is the
 * selection actually invalid?" checks. */
export function isPastDateTime(value: string): boolean {
  if (!value) return false
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return false
  return d.getTime() <= Date.now()
}

export function DateTimePicker({
  value,
  onChange,
  min = new Date(),
  placeholder = "Pick date & time",
  className,
  showPastWarning = true,
}: DateTimePickerProps) {
  const [open, setOpen] = React.useState(false)

  // Parse current value — guard against invalid date strings so we never
  // hand `format()` an Invalid Date (which throws RangeError).
  const selected = React.useMemo(() => {
    if (!value) return undefined
    const d = new Date(value)
    return Number.isNaN(d.getTime()) ? undefined : d
  }, [value])
  const timeStr = selected
    ? `${String(selected.getHours()).padStart(2, "0")}:${String(selected.getMinutes()).padStart(2, "0")}`
    : "12:00"

  const handleDateSelect = (day: Date | undefined) => {
    if (!day) return
    // Preserve the current time when changing date
    const [h, m] = timeStr.split(":").map(Number)
    day.setHours(h, m, 0, 0)
    onChange(formatForInput(day))
    setOpen(false)
  }

  const handleTimeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const [h, m] = e.target.value.split(":").map(Number)
    const base = selected ?? new Date()
    base.setHours(h, m, 0, 0)
    onChange(formatForInput(base))
  }

  // True if the currently-selected datetime is in the past.
  const isPast = selected ? selected.getTime() <= Date.now() : false

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation()
    onChange("")
  }

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex gap-2 items-center">
      {/* Date popover */}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className={cn(
              "flex-1 justify-start text-left font-normal gap-2",
              !selected && "text-muted-foreground"
            )}
          >
            <CalendarIcon className="h-4 w-4 shrink-0" />
            {selected ? format(selected, "d MMM yyyy") : <span>{placeholder}</span>}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={selected}
            onSelect={handleDateSelect}
            disabled={(day) => day < new Date(min.getFullYear(), min.getMonth(), min.getDate())}
          />
        </PopoverContent>
      </Popover>

      {/* Time input — only visible when a date is selected */}
      {selected && (
        <input
          type="time"
          value={timeStr}
          onChange={handleTimeChange}
          className="rounded-md border bg-background px-3 py-2 text-sm w-28 focus:outline-none focus:ring-2 focus:ring-ring appearance-none [&::-webkit-calendar-picker-indicator]:hidden"
        />
      )}

      {/* Clear */}
      {selected && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0 text-muted-foreground hover:text-foreground"
          onClick={handleClear}
        >
          <X className="h-4 w-4" />
        </Button>
      )}
      </div>

      {/* Inline past-time warning — opt-in via showPastWarning (default on).
          Parents can disable when they render their own validation copy. */}
      {showPastWarning && isPast && (
        <p className="text-xs text-destructive flex items-center gap-1.5">
          <AlertCircle className="h-3 w-3 shrink-0" />
          Pick a future date and time — past times can&apos;t be scheduled.
        </p>
      )}
    </div>
  )
}

function formatForInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}
